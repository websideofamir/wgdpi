import { describe, expect, it } from 'vitest';

import { paddingDescription, paddingForPacket } from '../src/padding.js';

describe('padding policy', () => {
  it('pads every packet in all mode', () => {
    const transport = Buffer.alloc(128);
    transport.writeUInt32LE(4, 0);

    expect(paddingForPacket(transport, { padTo: 1510, padMode: 'all' })).toBe(1510);
  });

  it('pads WireGuard handshake and control packets in handshake mode', () => {
    const initiation = Buffer.alloc(148);
    initiation.writeUInt32LE(1, 0);

    const response = Buffer.alloc(92);
    response.writeUInt32LE(2, 0);

    const cookieReply = Buffer.alloc(64);
    cookieReply.writeUInt32LE(3, 0);

    expect(paddingForPacket(initiation, { padTo: 1510, padMode: 'handshake' })).toBe(1510);
    expect(paddingForPacket(response, { padTo: 1510, padMode: 'handshake' })).toBe(1510);
    expect(paddingForPacket(cookieReply, { padTo: 1510, padMode: 'handshake' })).toBe(1510);
  });

  it('does not pad WireGuard transport data in handshake mode', () => {
    const transport = Buffer.alloc(128);
    transport.writeUInt32LE(4, 0);

    expect(paddingForPacket(transport, { padTo: 1510, padMode: 'handshake' })).toBe(0);
  });

  it('describes active padding mode', () => {
    expect(paddingDescription({ padTo: 1510, padMode: 'handshake' })).toBe('fixed padding length 1510, pad mode handshake');
  });
});
