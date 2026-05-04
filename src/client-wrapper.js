import dgram from 'node:dgram';

import { normalizePacket, wrapPacket } from './protocol.js';

export async function createClientWrapper(options) {
  const localSocket = dgram.createSocket('udp4');
  const remoteSocket = dgram.createSocket('udp4');
  const logger = options.logger ?? console;
  let localPeer = null;

  localSocket.on('message', (packet, rinfo) => {
    localPeer = { address: rinfo.address, port: rinfo.port };

    try {
      const wrapped = wrapPacket(packet, { padTo: options.padTo });
      remoteSocket.send(wrapped, options.remote.port, options.remote.host);
    } catch (error) {
      logger.error(`failed to wrap local packet: ${error.message}`);
    }
  });

  remoteSocket.on('message', (packet) => {
    if (!localPeer) {
      logger.warn('dropping remote packet before a local WireGuard peer is known');
      return;
    }

    try {
      const normalized = normalizePacket(packet, { allowPlain: true });
      localSocket.send(normalized.packet, localPeer.port, localPeer.address);
    } catch (error) {
      logger.error(`failed to normalize remote packet: ${error.message}`);
    }
  });

  await bind(remoteSocket, 0, options.remoteBindHost ?? '0.0.0.0');
  await bind(localSocket, options.local.port, options.local.host);

  logger.log(
    `client wrapper listening on ${options.local.host}:${options.local.port}, `
      + `forwarding to ${options.remote.host}:${options.remote.port}`,
  );

  return {
    localAddress: localSocket.address(),
    remoteAddress: remoteSocket.address(),
    close() {
      localSocket.close();
      remoteSocket.close();
    },
  };
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
