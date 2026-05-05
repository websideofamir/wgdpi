import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PREFIX,
  isWireGuardPacket,
  normalizePacket,
  parseWireGuardPacket,
  unwrapPacket,
  wrapPacket,
} from '../src/protocol.js';

describe('protocol wrapper', () => {
  it('wraps packets with prefix, little-endian length, inner packet, and random padding', () => {
    const handshake = Buffer.alloc(148, 0xaa);
    handshake.writeUInt32LE(1, 0);
    handshake.writeUInt32LE(0x230b4caf, 4);

    const wrapped = wrapPacket(handshake, { padTo: 1510 });

    expect(wrapped).toHaveLength(1510);
    expect(wrapped.subarray(0, 4)).toEqual(DEFAULT_PREFIX);
    expect(wrapped.readUInt16LE(4)).toBe(148);
    expect(wrapped.subarray(6, 154)).toEqual(handshake);
    const padding = wrapped.subarray(154);
    expect(padding).toHaveLength(1356);
    expect(padding.some((byte) => byte !== 0)).toBe(true);
  });

  it('unwraps packets and reports padding length', () => {
    const packet = Buffer.alloc(92, 0xbb);
    packet.writeUInt32LE(2, 0);

    const wrapped = wrapPacket(packet, { padTo: 256 });
    const unwrapped = unwrapPacket(wrapped);

    expect(unwrapped.packet).toEqual(packet);
    expect(unwrapped.paddingLength).toBe(158);
  });

  it('randomizes wrapped packet length within a configured range', () => {
    const packet = Buffer.alloc(92, 0xbb);
    packet.writeUInt32LE(2, 0);
    const lengths = new Set();

    for (let index = 0; index < 64; index += 1) {
      const wrapped = wrapPacket(packet, { padMin: 128, padMax: 160 });
      lengths.add(wrapped.length);

      expect(wrapped.length).toBeGreaterThanOrEqual(128);
      expect(wrapped.length).toBeLessThanOrEqual(160);
      expect(unwrapPacket(wrapped).packet).toEqual(packet);
    }

    expect(lengths.size).toBeGreaterThan(1);
  });

  it('uses the minimum valid length when a random padding range is smaller than the packet', () => {
    const packet = Buffer.alloc(148, 0xaa);
    packet.writeUInt32LE(1, 0);

    const wrapped = wrapPacket(packet, { padMin: 64, padMax: 80 });

    expect(wrapped).toHaveLength(154);
    expect(unwrapPacket(wrapped).packet).toEqual(packet);
  });

  it('uses a custom prefix when wrapping and unwrapping packets', () => {
    const packet = Buffer.alloc(92, 0xbb);
    const prefix = Buffer.from('7a21c90e', 'hex');
    packet.writeUInt32LE(2, 0);

    const wrapped = wrapPacket(packet, { padTo: 256, prefix });

    expect(wrapped.subarray(0, 4)).toEqual(prefix);
    expect(unwrapPacket(wrapped)).toBeNull();
    expect(unwrapPacket(wrapped, { prefix }).packet).toEqual(packet);
  });

  it('normalizes plain packets when allowed', () => {
    const packet = Buffer.from([1, 2, 3]);

    expect(normalizePacket(packet, { allowPlain: true })).toEqual({
      packet,
      paddingLength: 0,
      wrapped: false,
    });
  });
});

describe('WireGuard parsing', () => {
  it('parses a handshake initiation sender index', () => {
    const packet = Buffer.alloc(148);
    packet.writeUInt32LE(1, 0);
    packet.writeUInt32LE(0x230b4caf, 4);

    expect(isWireGuardPacket(packet)).toBe(true);
    expect(parseWireGuardPacket(packet)).toMatchObject({
      type: 1,
      typeName: 'handshake-initiation',
      senderIndex: 0x230b4caf,
    });
  });

  it('parses a handshake response receiver index', () => {
    const packet = Buffer.alloc(92);
    packet.writeUInt32LE(2, 0);
    packet.writeUInt32LE(0xdbee97fd, 4);
    packet.writeUInt32LE(0xb2c0f40a, 8);

    expect(parseWireGuardPacket(packet)).toMatchObject({
      type: 2,
      senderIndex: 0xdbee97fd,
      receiverIndex: 0xb2c0f40a,
    });
  });
});
