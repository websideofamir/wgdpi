import { describe, expect, it } from 'vitest';

import { EndpointMap } from '../src/endpoint-map.js';

describe('EndpointMap', () => {
  it('maps a server handshake response to the client initiation sender index', () => {
    const map = new EndpointMap();
    const endpoint = { address: '203.0.113.10', port: 50031 };
    const initiation = Buffer.alloc(148);
    initiation.writeUInt32LE(1, 0);
    initiation.writeUInt32LE(0xb2c0f40a, 4);

    const response = Buffer.alloc(92);
    response.writeUInt32LE(2, 0);
    response.writeUInt32LE(0xdbee97fd, 4);
    response.writeUInt32LE(0xb2c0f40a, 8);

    map.registerClientPacket(initiation, endpoint);

    expect(map.resolveServerPacket(response)).toMatchObject(endpoint);
  });

  it('falls back to the only active endpoint for server packets without a known receiver', () => {
    const map = new EndpointMap();
    const endpoint = { address: '203.0.113.10', port: 50031 };
    const clientPacket = Buffer.alloc(148);
    const serverInitiation = Buffer.alloc(148);
    clientPacket.writeUInt32LE(1, 0);
    serverInitiation.writeUInt32LE(1, 0);

    map.registerClientPacket(clientPacket, endpoint);

    expect(map.resolveServerPacket(serverInitiation)).toMatchObject(endpoint);
  });
});
