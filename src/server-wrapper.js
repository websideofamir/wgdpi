import dgram from 'node:dgram';

import { EndpointMap } from './endpoint-map.js';
import {
  DEFAULT_PAD_TO,
  DEFAULT_PREFIX,
  normalizePacket,
  parseWireGuardPacket,
  wrapPacket,
} from './protocol.js';

export async function createServerWrapper(options) {
  const publicSocket = dgram.createSocket('udp4');
  const wireGuardSocket = dgram.createSocket('udp4');
  const endpoints = new EndpointMap({ ttlMs: options.endpointTtlMs });
  const logger = options.logger ?? console;
  const replyMode = options.replyMode ?? 'plain';
  const counters = {
    clientPackets: 0,
    wrappedClientPackets: 0,
    plainClientPackets: 0,
    droppedUnwrappedClientPackets: 0,
    malformedClientPackets: 0,
    forwardedToWireGuard: 0,
    wireGuardPackets: 0,
    droppedWireGuardNoEndpoint: 0,
    repliesSent: 0,
    wrappedReplies: 0,
    forwardErrors: 0,
  };
  let lastClientEndpoint = null;
  let warnedUnwrappedClient = false;
  let warnedWireGuardNoEndpoint = false;
  let loggedMalformedClient = false;
  let loggedForwardError = false;
  let logTimer = null;

  publicSocket.on('message', (packet, rinfo) => {
    counters.clientPackets += 1;

    try {
      const normalized = normalizePacket(packet, {
        allowPlain: options.allowPlainClients,
        prefix: options.prefix,
      });
      if (!normalized) {
        counters.droppedUnwrappedClientPackets += 1;
        if (!warnedUnwrappedClient) {
          logger.warn(`dropping unwrapped client packet from ${rinfo.address}:${rinfo.port}; use --allow-plain-clients only for testing plain clients; further drops counted in traffic summary`);
          warnedUnwrappedClient = true;
        }
        return;
      }

      if (normalized.wrapped) {
        counters.wrappedClientPackets += 1;
      } else {
        counters.plainClientPackets += 1;
      }

      const endpointKey = `${rinfo.address}:${rinfo.port}`;
      if (lastClientEndpoint !== endpointKey) {
        lastClientEndpoint = endpointKey;
        logger.log(`client endpoint active: ${endpointKey}`);
      }

      endpoints.registerClientPacket(normalized.packet, {
        address: rinfo.address,
        port: rinfo.port,
      });

      counters.forwardedToWireGuard += 1;
      wireGuardSocket.send(normalized.packet, options.wireguard.port, options.wireguard.host);
    } catch (error) {
      counters.malformedClientPackets += 1;
      if (!loggedMalformedClient) {
        logger.error(`failed to unwrap client packet: ${error.message}; further malformed packets counted in traffic summary`);
        loggedMalformedClient = true;
      }
    }
  });

  wireGuardSocket.on('message', (packet) => {
    counters.wireGuardPackets += 1;

    const endpoint = endpoints.resolveServerPacket(packet);
    if (!endpoint) {
      counters.droppedWireGuardNoEndpoint += 1;
      if (!warnedWireGuardNoEndpoint) {
        logger.warn('dropping WireGuard server packet because no client endpoint is known; further drops counted in traffic summary');
        warnedWireGuardNoEndpoint = true;
      }
      return;
    }

    try {
      const outgoing = shouldWrapServerReply(packet, replyMode)
        ? wrapPacket(packet, serverReplyWrapperOptions(packet, replyMode, options))
        : packet;

      if (outgoing !== packet) {
        counters.wrappedReplies += 1;
      }

      counters.repliesSent += 1;
      publicSocket.send(outgoing, endpoint.port, endpoint.address);
    } catch (error) {
      counters.forwardErrors += 1;
      if (!loggedForwardError) {
        logger.error(`failed to forward WireGuard server packet: ${error.message}; further forward errors counted in traffic summary`);
        loggedForwardError = true;
      }
    }
  });

  await bind(wireGuardSocket, 0, options.wireguardBindHost ?? '127.0.0.1');
  await bind(publicSocket, options.listen.port, options.listen.host);

  logger.log(
    `server wrapper listening on ${options.listen.host}:${options.listen.port}, `
      + `forwarding to WireGuard at ${options.wireguard.host}:${options.wireguard.port}, `
      + `reply mode ${replyMode}, ${paddingDescription(options)}, `
      + `pad bytes ${options.padBytes ?? 'random'}, prefix ${formatPrefix(options.prefix)}`,
  );

  logTimer = startTrafficSummary('server', counters, () => lastClientEndpoint, logger, options.logIntervalMs);

  return {
    listenAddress: publicSocket.address(),
    wireGuardAddress: wireGuardSocket.address(),
    close() {
      if (logTimer) clearInterval(logTimer);
      publicSocket.close();
      wireGuardSocket.close();
    },
  };
}

function wrapperOptions(options) {
  return {
    padTo: options.padTo,
    padMin: options.padMin,
    padMax: options.padMax,
    prefix: options.prefix,
    padBytes: options.padBytes,
  };
}

function shouldWrapServerReply(packet, replyMode) {
  if (replyMode === 'wrapped') {
    return true;
  }

  if (replyMode === 'adaptive') {
    return true;
  }

  if (replyMode === 'plain') {
    return false;
  }

  const parsed = parseWireGuardPacket(packet);
  return parsed?.type !== 4;
}

function serverReplyWrapperOptions(packet, replyMode, options) {
  if (replyMode !== 'adaptive') {
    return wrapperOptions(options);
  }

  const parsed = parseWireGuardPacket(packet);
  if (parsed?.type !== 4) {
    return wrapperOptions(options);
  }

  return {
    prefix: options.prefix,
    padBytes: options.padBytes,
    padTo: 0,
  };
}

function startTrafficSummary(name, counters, lastEndpoint, logger, intervalMs) {
  if (!intervalMs) {
    return null;
  }

  return setInterval(() => {
    logger.log(
      `${name} traffic summary: clientPackets=${counters.clientPackets}, `
        + `wrappedClient=${counters.wrappedClientPackets}, plainClient=${counters.plainClientPackets}, `
        + `droppedUnwrapped=${counters.droppedUnwrappedClientPackets}, malformedClient=${counters.malformedClientPackets}, `
        + `forwardedToWireGuard=${counters.forwardedToWireGuard}, wireGuardPackets=${counters.wireGuardPackets}, `
        + `repliesSent=${counters.repliesSent}, wrappedReplies=${counters.wrappedReplies}, `
        + `droppedNoEndpoint=${counters.droppedWireGuardNoEndpoint}, forwardErrors=${counters.forwardErrors}, `
        + `lastClientEndpoint=${lastEndpoint() ?? 'none'}`,
    );
  }, intervalMs).unref();
}

function paddingDescription(options) {
  if (options.padMin !== undefined) {
    return `random padding length ${options.padMin}-${options.padMax}`;
  }

  return `fixed padding length ${options.padTo ?? DEFAULT_PAD_TO}`;
}

function formatPrefix(prefix) {
  return `0x${(prefix ?? DEFAULT_PREFIX).toString('hex')}`;
}

function bind(socket, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      socket.off('listening', onListening);
      reject(error);
    };

    const onListening = () => {
      socket.off('error', onError);
      resolve();
    };

    socket.once('error', onError);
    socket.once('listening', onListening);
    socket.bind(port, host);
  });
}
