import dgram from 'node:dgram';

import { afterEach, describe, expect, it } from 'vitest';

import { createClient } from '../src/client.js';
import { createServer } from '../src/server.js';

const seedHex = '9f2b7c4a81d3e0b7f5a60d9a3c11e274ba69cd04f43a830611e09db2320f91aa';
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

describe('obfs wrapper forwarding', () => {
  it('encrypts client packets, decrypts them on the server, and encrypts replies', async () => {
    const wireGuardServer = dgram.createSocket('udp4');
    closers.push(() => wireGuardServer.close());
    await bind(wireGuardServer, 0, '127.0.0.1');

    const server = await createServer({
      listen: { host: '127.0.0.1', port: 0 },
      wireguard: { host: '127.0.0.1', port: wireGuardServer.address().port },
      seedHex,
      salt: 'integration',
      padTo: 1510,
      padMode: 'handshake',
      logger: silentLogger,
      logIntervalMs: 0,
    });
    closers.push(() => server.close());

    const client = await createClient({
      local: { host: '127.0.0.1', port: 0 },
      remote: { host: '127.0.0.1', port: server.listenAddress.port },
      seedHex,
      salt: 'integration',
      keyId: 999_999,
      padTo: 1510,
      padMode: 'handshake',
      logger: silentLogger,
      logIntervalMs: 0,
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
