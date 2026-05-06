import dgram from 'node:dgram';

import { createSecretResolver } from './key-derivation.js';
import { TAG_BYTES, NONCE_BYTES, encodePacket, decodePacket } from './protocol.js';

export async function createClient(options) {
  const localSocket = dgram.createSocket('udp4');
  const remoteSocket = dgram.createSocket('udp4');
  const secrets = createSecretResolver(options);
  const selectedSecret = secrets.get(options.keyId);
  const logger = options.logger ?? console;
  const counters = {
    localPackets: 0,
    remotePackets: 0,
    encryptedPackets: 0,
    decryptedPackets: 0,
    encryptErrors: 0,
    decryptErrors: 0,
    droppedRemoteBeforeLocalPeer: 0,
  };
  let localPeer = null;
  let localPeerKey = null;
  let warnedRemoteBeforeLocalPeer = false;
  let loggedEncryptError = false;
  let loggedDecryptError = false;
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
      const encrypted = encodePacket(packet, { keyId: options.keyId, secret: selectedSecret, padTo: options.padTo });
      counters.encryptedPackets += 1;
      remoteSocket.send(encrypted, options.remote.port, options.remote.host);
    } catch (error) {
      counters.encryptErrors += 1;
      if (!loggedEncryptError) {
        logger.error(`failed to encrypt local packet: ${error.message}; further encrypt errors counted in traffic summary`);
        loggedEncryptError = true;
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
      const decoded = decodePacket(packet, secrets);
      counters.decryptedPackets += 1;
      localSocket.send(decoded.packet, localPeer.port, localPeer.address);
    } catch (error) {
      counters.decryptErrors += 1;
      if (!loggedDecryptError) {
        logger.error(`failed to decrypt remote packet: ${error.message}; further decrypt errors counted in traffic summary`);
        loggedDecryptError = true;
      }
    }
  });

  await bind(remoteSocket, 0, options.remoteBindHost ?? '0.0.0.0');
  await bind(localSocket, options.local.port, options.local.host);

  logger.log(
    `obfs client listening on ${options.local.host}:${options.local.port}, `
      + `remote socket ${formatAddress(remoteSocket.address())}, `
      + `forwarding to ${options.remote.host}:${options.remote.port}, `
      + `secret source ${secrets.type}, secrets=${secrets.size}, key_id=${options.keyId}, `
      + `nonce=${NONCE_BYTES}, tag=${TAG_BYTES}, ${paddingDescription(options)}, prefix=none`,
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

function startTrafficSummary(name, counters, logger, intervalMs) {
  if (!intervalMs) {
    return null;
  }

  return setInterval(() => {
    logger.log(
      `${name} traffic summary: local=${counters.localPackets}, remote=${counters.remotePackets}, `
        + `encrypted=${counters.encryptedPackets}, decrypted=${counters.decryptedPackets}, `
        + `droppedRemoteBeforeLocalPeer=${counters.droppedRemoteBeforeLocalPeer}, `
        + `encryptErrors=${counters.encryptErrors}, decryptErrors=${counters.decryptErrors}`,
    );
  }, intervalMs).unref();
}

function formatAddress(address) {
  return `${address.address}:${address.port}`;
}

function paddingDescription(options) {
  return options.padTo ? `fixed padding length ${options.padTo}` : 'padding=none';
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
