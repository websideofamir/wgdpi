import dgram from 'node:dgram';

import { afterEach, describe, expect, it } from 'vitest';

import { createClientWrapper } from '../src/client-wrapper.js';
import { createServerWrapper } from '../src/server-wrapper.js';
import { wrapPacket } from '../src/protocol.js';

const silentLogger = {
  log() {},
  warn() {},
  error() {},
};

const closers = [];

afterEach(() => {
  while (closers.length > 0) {
    closers.pop()();
  }
});

describe('wrapper forwarding', () => {
  it('wraps client packets, unwraps them on the server, and returns plain replies', async () => {
    const wireGuardServer = dgram.createSocket('udp4');
    closers.push(() => wireGuardServer.close());
    await bind(wireGuardServer, 0, '127.0.0.1');

    const server = await createServerWrapper({
      listen: { host: '127.0.0.1', port: 0 },
      wireguard: { host: '127.0.0.1', port: wireGuardServer.address().port },
      logger: silentLogger,
      padTo: 1510,
      replyMode: 'plain',
    });
    closers.push(() => server.close());

    const client = await createClientWrapper({
      local: { host: '127.0.0.1', port: 0 },
      remote: { host: '127.0.0.1', port: server.listenAddress.port },
      logger: silentLogger,
      padTo: 1510,
    });
    closers.push(() => client.close());

    const localWireGuardClient = dgram.createSocket('udp4');
    closers.push(() => localWireGuardClient.close());
    await bind(localWireGuardClient, 0, '127.0.0.1');

    const initiation = Buffer.alloc(148);
    initiation.writeUInt32LE(1, 0);
    initiation.writeUInt32LE(0xb2c0f40a, 4);

    const wireGuardServerMessage = onceMessage(wireGuardServer);
    localWireGuardClient.send(initiation, client.localAddress.port, '127.0.0.1');

    const [receivedByWireGuardServer, serverWrapperEndpoint] = await wireGuardServerMessage;
    expect(receivedByWireGuardServer).toEqual(initiation);

    const response = Buffer.alloc(92);
    response.writeUInt32LE(2, 0);
    response.writeUInt32LE(0xdbee97fd, 4);
    response.writeUInt32LE(0xb2c0f40a, 8);

    const localClientMessage = onceMessage(localWireGuardClient);
    wireGuardServer.send(response, serverWrapperEndpoint.port, serverWrapperEndpoint.address);

    const [receivedByLocalClient] = await localClientMessage;
    expect(receivedByLocalClient).toEqual(response);
  });

  it('uses the captured envelope shape for outbound packets', () => {
    const initiation = Buffer.alloc(148);
    initiation.writeUInt32LE(1, 0);

    const wrapped = wrapPacket(initiation, { padTo: 1510 });

    expect(wrapped.subarray(0, 10)).toEqual(Buffer.from([
      0x00, 0x00, 0x00, 0x00,
      0x94, 0x00,
      0x01, 0x00, 0x00, 0x00,
    ]));
  });
});

function bind(socket, port, host) {
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(port, host, () => {
      socket.off('error', reject);
      resolve();
    });
  });
}

function onceMessage(socket) {
  return new Promise((resolve) => {
    socket.once('message', (packet, rinfo) => resolve([packet, rinfo]));
  });
}
