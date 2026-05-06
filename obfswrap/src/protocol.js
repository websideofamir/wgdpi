import { createCipheriv, createDecipheriv, randomBytes, randomFillSync } from 'node:crypto';

import { KEY_ID_BYTES, decodeKeyId, encodeKeyId } from './key-derivation.js';

export const VERSION = 1;
export const VERSION_BYTES = 1;
export const INNER_LENGTH_BYTES = 2;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 8;
export const MAX_INNER_LENGTH = 0xffff;
export const MAX_UDP_PAYLOAD = 65507;
export const CIPHER = 'chacha20-poly1305';
export const PUBLIC_HEADER_BYTES = KEY_ID_BYTES + NONCE_BYTES;
export const FIXED_OVERHEAD_BYTES = PUBLIC_HEADER_BYTES + TAG_BYTES;
export const MIN_PLAINTEXT_BYTES = VERSION_BYTES + INNER_LENGTH_BYTES;
export const MIN_PACKET_BYTES = PUBLIC_HEADER_BYTES + TAG_BYTES;

export class ProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProtocolError';
  }
}

export function encodePacket(innerPacket, { keyId, secret, padTo }) {
  validateInnerPacket(innerPacket);
  validateSecret(secret);

  const nonce = randomBytes(NONCE_BYTES);
  const minimumPlaintextLength = MIN_PLAINTEXT_BYTES + innerPacket.length;
  const plaintextLength = choosePlaintextLength(minimumPlaintextLength, padTo);
  const plaintext = Buffer.alloc(plaintextLength);
  plaintext[0] = VERSION;
  plaintext.writeUInt16LE(innerPacket.length, VERSION_BYTES);
  innerPacket.copy(plaintext, MIN_PLAINTEXT_BYTES);

  const paddingOffset = MIN_PLAINTEXT_BYTES + innerPacket.length;
  if (paddingOffset < plaintext.length) {
    randomFillSync(plaintext, paddingOffset);
  }

  const cipher = createCipheriv(CIPHER, secret, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(encodeKeyId(keyId));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([encodeKeyId(keyId), nonce, ciphertext, tag]);
}

export function decodePacket(packet, secretResolver) {
  if (!Buffer.isBuffer(packet)) {
    throw new ProtocolError('packet must be a Buffer');
  }

  if (packet.length < MIN_PACKET_BYTES + MIN_PLAINTEXT_BYTES) {
    throw new ProtocolError('packet is too short');
  }

  const keyId = decodeKeyId(packet, 0);
  const secret = secretResolver.get(keyId);
  validateSecret(secret);

  const keyIdBytes = packet.subarray(0, KEY_ID_BYTES);
  const nonce = packet.subarray(KEY_ID_BYTES, PUBLIC_HEADER_BYTES);
  const tag = packet.subarray(packet.length - TAG_BYTES);
  const ciphertext = packet.subarray(PUBLIC_HEADER_BYTES, packet.length - TAG_BYTES);

  let plaintext;
  try {
    const decipher = createDecipheriv(CIPHER, secret, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(keyIdBytes);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    throw new ProtocolError('packet authentication failed');
  }

  if (plaintext.length < MIN_PLAINTEXT_BYTES) {
    throw new ProtocolError('decrypted packet is too short');
  }

  const version = plaintext[0];
  if (version !== VERSION) {
    throw new ProtocolError(`unsupported packet version ${version}`);
  }

  const innerLength = plaintext.readUInt16LE(VERSION_BYTES);
  const end = MIN_PLAINTEXT_BYTES + innerLength;

  if (innerLength === 0) {
    throw new ProtocolError('inner packet is empty');
  }

  if (end > plaintext.length) {
    throw new ProtocolError('decrypted packet length exceeds plaintext length');
  }

  return {
    keyId,
    packet: Buffer.from(plaintext.subarray(MIN_PLAINTEXT_BYTES, end)),
  };
}

function validateInnerPacket(packet) {
  if (!Buffer.isBuffer(packet)) {
    throw new ProtocolError('inner packet must be a Buffer');
  }

  if (packet.length === 0) {
    throw new ProtocolError('inner packet is empty');
  }

  if (packet.length > MAX_INNER_LENGTH) {
    throw new ProtocolError('inner packet is too large for the 2-byte length field');
  }
}

function validateSecret(secret) {
  if (!Buffer.isBuffer(secret) || secret.length !== 32) {
    throw new ProtocolError('secret must be exactly 32 bytes');
  }
}

function choosePlaintextLength(minimumPlaintextLength, padTo) {
  if (padTo === undefined || padTo === 0) {
    return minimumPlaintextLength;
  }

  if (!Number.isInteger(padTo) || padTo < 0) {
    throw new ProtocolError('padTo must be a non-negative integer');
  }

  if (padTo > MAX_UDP_PAYLOAD) {
    throw new ProtocolError(`padTo must be less than or equal to ${MAX_UDP_PAYLOAD}`);
  }

  const targetPlaintextLength = padTo - FIXED_OVERHEAD_BYTES;
  return Math.max(minimumPlaintextLength, targetPlaintextLength);
}
