import dgram from 'node:dgram';

import { EndpointMap } from './endpoint-map.js';
import { createSecretResolver } from './key-derivation.js';
import { paddingDescription, paddingForPacket } from './padding.js';
import { TAG_BYTES, NONCE_BYTES, encodePacket, decodePacket } from './protocol.js';

export async function createServer(options) {
  const publicSocket = dgram.createSocket('udp4');
  const wireGuardSocket = dgram.createSocket('udp4');
  const endpoints = new EndpointMap({ ttlMs: options.endpointTtlMs });
  const secrets = createSecretResolver(options);
  const logger = options.logger ?? console;
  const counters = {
    clientPackets: 0,
    decryptedClientPackets: 0,
    malformedClientPackets: 0,
    forwardedToWireGuard: 0,
    wireGuardPackets: 0,
    encryptedReplies: 0,
    repliesSent: 0,
    droppedWireGuardNoEndpoint: 0,
    forwardErrors: 0,
  };
  let lastClientEndpoint = null;
  let loggedMalformedClient = false;
  let warnedWireGuardNoEndpoint = false;
  let loggedForwardError = false;
  let logTimer = null;

  publicSocket.on('message', (packet, rinfo) => {
    counters.clientPackets += 1;

    try {
      const decoded = decodePacket(packet, secrets);
      counters.decryptedClientPackets += 1;

      const endpointKey = `${rinfo.address}:${rinfo.port}`;
      if (lastClientEndpoint !== endpointKey) {
        lastClientEndpoint = endpointKey;
        logger.log(`client endpoint active: ${endpointKey}, key_id=${decoded.keyId}`);
      }

      endpoints.registerClientPacket(decoded.packet, { address: rinfo.address, port: rinfo.port }, decoded.keyId);

      counters.forwardedToWireGuard += 1;
      wireGuardSocket.send(decoded.packet, options.wireguard.port, options.wireguard.host);
    } catch (error) {
      counters.malformedClientPackets += 1;
      if (!loggedMalformedClient) {
        logger.error(`failed to decrypt client packet: ${error.message}; further malformed packets counted in traffic summary`);
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
      const secret = secrets.get(endpoint.keyId);
      const encrypted = encodePacket(packet, { keyId: endpoint.keyId, secret, padTo: paddingForPacket(packet, options) });
      counters.encryptedReplies += 1;
      counters.repliesSent += 1;
      publicSocket.send(encrypted, endpoint.port, endpoint.address);
    } catch (error) {
      counters.forwardErrors += 1;
      if (!loggedForwardError) {
        logger.error(`failed to encrypt WireGuard server packet: ${error.message}; further forward errors counted in traffic summary`);
        loggedForwardError = true;
      }
    }
  });

  await bind(wireGuardSocket, 0, options.wireguardBindHost ?? '127.0.0.1');
  await bind(publicSocket, options.listen.port, options.listen.host);

  logger.log(
    `obfs server listening on ${options.listen.host}:${options.listen.port}, `
      + `forwarding to WireGuard at ${options.wireguard.host}:${options.wireguard.port}, `
      + `secret source ${secrets.type}, secrets=${secrets.size}, `
      + `nonce=${NONCE_BYTES}, tag=${TAG_BYTES}, ${paddingDescription(options)}, prefix=none`,
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

function startTrafficSummary(name, counters, lastEndpoint, logger, intervalMs) {
  if (!intervalMs) {
    return null;
  }

  return setInterval(() => {
    logger.log(
      `${name} traffic summary: clientPackets=${counters.clientPackets}, `
        + `decryptedClient=${counters.decryptedClientPackets}, malformedClient=${counters.malformedClientPackets}, `
        + `forwardedToWireGuard=${counters.forwardedToWireGuard}, wireGuardPackets=${counters.wireGuardPackets}, `
        + `encryptedReplies=${counters.encryptedReplies}, repliesSent=${counters.repliesSent}, `
        + `droppedNoEndpoint=${counters.droppedWireGuardNoEndpoint}, forwardErrors=${counters.forwardErrors}, `
        + `lastClientEndpoint=${lastEndpoint() ?? 'none'}`,
    );
  }, intervalMs).unref();
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
