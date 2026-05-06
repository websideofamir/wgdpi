import { describe, expect, it } from 'vitest';

import { decodeKeyId, deriveSecret, encodeKeyId, parseSeedHex } from '../src/key-derivation.js';
import { NONCE_BYTES, PUBLIC_HEADER_BYTES, TAG_BYTES, decodePacket, encodePacket } from '../src/protocol.js';

const seedHex = '9f2b7c4a81d3e0b7f5a60d9a3c11e274ba69cd04f43a830611e09db2320f91aa';
const seed = parseSeedHex(seedHex);
const salt = 'test-profile-v1';

describe('obfs protocol', () => {
  it('encodes and decodes a packet with a 3-byte key_id, 12-byte nonce, and 8-byte tag', () => {
    const keyId = 999_999;
    const secret = deriveSecret(seed, salt, keyId);
    const inner = Buffer.alloc(148);
    inner.writeUInt32LE(1, 0);
    inner.writeUInt32LE(0xb2c0f40a, 4);

    const encoded = encodePacket(inner, { keyId, secret });

    expect(encoded.subarray(0, 3).toString('hex')).toBe('0f423f');
    expect(encoded.subarray(3, 3 + NONCE_BYTES)).toHaveLength(12);
    expect(encoded.subarray(encoded.length - TAG_BYTES)).toHaveLength(8);
    expect(encoded).toHaveLength(3 + 12 + 1 + 2 + inner.length + 8);

    const decoded = decodePacket(encoded, {
      get(nextKeyId) {
        expect(nextKeyId).toBe(keyId);
        return deriveSecret(seed, salt, nextKeyId);
      },
    });

    expect(decoded.keyId).toBe(keyId);
    expect(decoded.packet).toEqual(inner);
  });

  it('pads the public UDP payload to a fixed length while encrypting padding', () => {
    const keyId = 999_999;
    const secret = deriveSecret(seed, salt, keyId);
    const inner = Buffer.alloc(148);
    inner.writeUInt32LE(1, 0);

    const encoded = encodePacket(inner, { keyId, secret, padTo: 1510 });
    const decoded = decodePacket(encoded, { get: () => secret });

    expect(encoded).toHaveLength(1510);
    expect(decoded.packet).toEqual(inner);
  });

  it('does not truncate packets that are larger than the fixed padding target', () => {
    const keyId = 7;
    const secret = deriveSecret(seed, salt, keyId);
    const inner = Buffer.alloc(1600);
    inner.writeUInt32LE(4, 0);

    const encoded = encodePacket(inner, { keyId, secret, padTo: 1510 });
    const decoded = decodePacket(encoded, { get: () => secret });

    expect(encoded.length).toBeGreaterThan(1510);
    expect(decoded.packet).toEqual(inner);
  });

  it('does not expose the WireGuard type at a fixed plaintext offset', () => {
    const keyId = 3;
    const secret = deriveSecret(seed, salt, keyId);
    const inner = Buffer.alloc(148);
    inner.writeUInt32LE(1, 0);

    const encoded = encodePacket(inner, { keyId, secret });

    expect(encoded.subarray(PUBLIC_HEADER_BYTES, PUBLIC_HEADER_BYTES + 4)).not.toEqual(Buffer.from([1, 0, 0, 0]));
  });

  it('fails when ciphertext is tampered', () => {
    const keyId = 4;
    const secret = deriveSecret(seed, salt, keyId);
    const encoded = encodePacket(Buffer.from('hello'), { keyId, secret });
    encoded[PUBLIC_HEADER_BYTES] ^= 0xff;

    expect(() => decodePacket(encoded, { get: () => secret })).toThrow('packet authentication failed');
  });

  it('fails when tag is tampered', () => {
    const keyId = 5;
    const secret = deriveSecret(seed, salt, keyId);
    const encoded = encodePacket(Buffer.from('hello'), { keyId, secret });
    encoded[encoded.length - 1] ^= 0xff;

    expect(() => decodePacket(encoded, { get: () => secret })).toThrow('packet authentication failed');
  });

  it('fails with the wrong secret', () => {
    const keyId = 6;
    const encoded = encodePacket(Buffer.from('hello'), { keyId, secret: deriveSecret(seed, salt, keyId) });
    const wrongSecret = deriveSecret(seed, 'different-salt', keyId);

    expect(() => decodePacket(encoded, { get: () => wrongSecret })).toThrow('packet authentication failed');
  });
});

describe('key_id encoding', () => {
  it('encodes one million secret indexes in 3 bytes', () => {
    expect(encodeKeyId(999_999).toString('hex')).toBe('0f423f');
    expect(decodeKeyId(Buffer.from('0f423f', 'hex'))).toBe(999_999);
  });

  it('encodes the max 3-byte key_id', () => {
    expect(encodeKeyId(0xffffff).toString('hex')).toBe('ffffff');
    expect(decodeKeyId(Buffer.from('ffffff', 'hex'))).toBe(0xffffff);
  });
});
