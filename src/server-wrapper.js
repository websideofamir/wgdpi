import dgram from 'node:dgram';

import { EndpointMap } from './endpoint-map.js';
import { normalizePacket, wrapPacket } from './protocol.js';

export async function createServerWrapper(options) {
  const publicSocket = dgram.createSocket('udp4');
  const wireGuardSocket = dgram.createSocket('udp4');
  const endpoints = new EndpointMap({ ttlMs: options.endpointTtlMs });
  const logger = options.logger ?? console;
  const replyMode = options.replyMode ?? 'plain';

  publicSocket.on('message', (packet, rinfo) => {
    try {
      const normalized = normalizePacket(packet, { allowPlain: options.allowPlainClients });
      if (!normalized) {
        logger.warn(`dropping unwrapped client packet from ${rinfo.address}:${rinfo.port}`);
        return;
      }

      endpoints.registerClientPacket(normalized.packet, {
        address: rinfo.address,
        port: rinfo.port,
      });

      wireGuardSocket.send(normalized.packet, options.wireguard.port, options.wireguard.host);
    } catch (error) {
      logger.error(`failed to unwrap client packet: ${error.message}`);
    }
  });

  wireGuardSocket.on('message', (packet) => {
    const endpoint = endpoints.resolveServerPacket(packet);
    if (!endpoint) {
      logger.warn('dropping WireGuard server packet because no client endpoint is known');
      return;
    }

    try {
      const outgoing = replyMode === 'wrapped'
        ? wrapPacket(packet, { padTo: options.padTo })
        : packet;

      publicSocket.send(outgoing, endpoint.port, endpoint.address);
    } catch (error) {
      logger.error(`failed to forward WireGuard server packet: ${error.message}`);
    }
  });

  await bind(wireGuardSocket, 0, options.wireguardBindHost ?? '127.0.0.1');
  await bind(publicSocket, options.listen.port, options.listen.host);

  logger.log(
    `server wrapper listening on ${options.listen.host}:${options.listen.port}, `
      + `forwarding to WireGuard at ${options.wireguard.host}:${options.wireguard.port}, `
      + `reply mode ${replyMode}`,
  );

  return {
    listenAddress: publicSocket.address(),
    wireGuardAddress: wireGuardSocket.address(),
    close() {
      publicSocket.close();
      wireGuardSocket.close();
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
