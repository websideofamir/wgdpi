import dgram from 'node:dgram';

import { DEFAULT_PAD_TO, DEFAULT_PREFIX, normalizePacket, wrapPacket } from './protocol.js';

export async function createClientWrapper(options) {
  const localSocket = dgram.createSocket('udp4');
  const remoteSocket = dgram.createSocket('udp4');
  const logger = options.logger ?? console;
  const counters = {
    localPackets: 0,
    remotePackets: 0,
    wrappedPackets: 0,
    plainRemotePackets: 0,
    wrapErrors: 0,
    normalizeErrors: 0,
    droppedRemoteBeforeLocalPeer: 0,
  };
  let localPeer = null;
  let localPeerKey = null;
  let warnedRemoteBeforeLocalPeer = false;
  let loggedWrapError = false;
  let loggedNormalizeError = false;
  let logTimer = null;

  localSocket.on('message', (packet, rinfo) => {
    localPeer = { address: rinfo.address, port: rinfo.port };
    counters.localPackets += 1;

    const nextLocalPeerKey = `${rinfo.address}:${rinfo.port}`;
    if (localPeerKey !== nextLocalPeerKey) {
      localPeerKey = nextLocalPeerKey;
      logger.log(`local WireGuard peer active: ${localPeerKey}`);
    }

    try {
      const wrapped = wrapPacket(packet, wrapperOptions(options));
      counters.wrappedPackets += 1;
      remoteSocket.send(wrapped, options.remote.port, options.remote.host);
    } catch (error) {
      counters.wrapErrors += 1;
      if (!loggedWrapError) {
        logger.error(`failed to wrap local packet: ${error.message}; further wrap errors counted in traffic summary`);
        loggedWrapError = true;
      }
    }
  });

  remoteSocket.on('message', (packet) => {
    counters.remotePackets += 1;

    if (!localPeer) {
      counters.droppedRemoteBeforeLocalPeer += 1;
      if (!warnedRemoteBeforeLocalPeer) {
        logger.warn('dropping remote packet before a local WireGuard peer is known; further drops counted in traffic summary');
        warnedRemoteBeforeLocalPeer = true;
      }
      return;
    }

    try {
      const normalized = normalizePacket(packet, { allowPlain: true, prefix: options.prefix });
      if (!normalized.wrapped) {
        counters.plainRemotePackets += 1;
      }
      localSocket.send(normalized.packet, localPeer.port, localPeer.address);
    } catch (error) {
      counters.normalizeErrors += 1;
      if (!loggedNormalizeError) {
        logger.error(`failed to normalize remote packet: ${error.message}; further normalize errors counted in traffic summary`);
        loggedNormalizeError = true;
      }
    }
  });

  await bind(remoteSocket, 0, options.remoteBindHost ?? '0.0.0.0');
  await bind(localSocket, options.local.port, options.local.host);

  logger.log(
    `client wrapper listening on ${options.local.host}:${options.local.port}, `
      + `forwarding to ${options.remote.host}:${options.remote.port}, `
      + `${paddingDescription(options)}, prefix ${formatPrefix(options.prefix)}`,
  );

  logTimer = startTrafficSummary('client', counters, logger, options.logIntervalMs);

  return {
    localAddress: localSocket.address(),
    remoteAddress: remoteSocket.address(),
    close() {
      if (logTimer) clearInterval(logTimer);
      localSocket.close();
      remoteSocket.close();
    },
  };
}

function wrapperOptions(options) {
  return {
    padTo: options.padTo,
    padMin: options.padMin,
    padMax: options.padMax,
    prefix: options.prefix,
  };
}

function startTrafficSummary(name, counters, logger, intervalMs) {
  if (!intervalMs) {
    return null;
  }

  return setInterval(() => {
    logger.log(
      `${name} traffic summary: local=${counters.localPackets}, remote=${counters.remotePackets}, `
        + `wrapped=${counters.wrappedPackets}, plainRemote=${counters.plainRemotePackets}, `
        + `droppedRemoteBeforeLocalPeer=${counters.droppedRemoteBeforeLocalPeer}, `
        + `wrapErrors=${counters.wrapErrors}, normalizeErrors=${counters.normalizeErrors}`,
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
