import { randomFillSync, randomInt } from 'node:crypto';

export const DEFAULT_PREFIX = Buffer.from([0x00, 0x00, 0x00, 0x00]);
export const WRAPPER_HEADER_LENGTH = 6;
export const DEFAULT_PAD_TO = 1510;
export const MAX_UDP_PAYLOAD = 65507;

const WIREGUARD_TYPES = new Set([1, 2, 3, 4]);
const MIN_WIREGUARD_LENGTH = new Map([
  [1, 148],
  [2, 92],
  [3, 64],
  [4, 32],
]);

export class ProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/**
 * Wraps a raw WireGuard UDP payload using the observed provider-like format.
 */
export function wrapPacket(packet, options = {}) {
  const prefix = options.prefix ?? DEFAULT_PREFIX;

  if (!Buffer.isBuffer(packet)) {
    throw new ProtocolError('packet must be a Buffer');
  }

  if (prefix.length !== 4) {
    throw new ProtocolError('prefix must be exactly 4 bytes');
  }

  if (packet.length > 0xffff) {
    throw new ProtocolError('packet is too large for the 2-byte length field');
  }

  const minimumLength = WRAPPER_HEADER_LENGTH + packet.length;
  const targetLength = chooseTargetLength(minimumLength, options);

  if (targetLength > MAX_UDP_PAYLOAD) {
    throw new ProtocolError('wrapped packet would exceed the maximum UDP payload');
  }

  const wrapped = Buffer.alloc(targetLength);
  prefix.copy(wrapped, 0);
  wrapped.writeUInt16LE(packet.length, 4);
  packet.copy(wrapped, WRAPPER_HEADER_LENGTH);

  const paddingLength = targetLength - minimumLength;
  if (paddingLength > 0) {
    randomFillSync(wrapped, minimumLength, paddingLength);
  }

  return wrapped;
}

/**
 * Unwraps a provider-like payload. Returns null when the packet is not wrapped.
 */
export function unwrapPacket(packet, options = {}) {
  const prefix = options.prefix ?? DEFAULT_PREFIX;

  if (!Buffer.isBuffer(packet)) {
    throw new ProtocolError('packet must be a Buffer');
  }

  if (!startsWith(packet, prefix)) {
    return null;
  }

  if (packet.length < WRAPPER_HEADER_LENGTH) {
    throw new ProtocolError('wrapped packet is shorter than the wrapper header');
  }

  const innerLength = packet.readUInt16LE(4);
  const end = WRAPPER_HEADER_LENGTH + innerLength;

  if (end > packet.length) {
    throw new ProtocolError('wrapped packet length exceeds the received payload');
  }

  return {
    packet: Buffer.from(packet.subarray(WRAPPER_HEADER_LENGTH, end)),
    paddingLength: packet.length - end,
    wrapped: true,
  };
}

/**
 * Accepts either wrapped or plain packets, returning a normalized payload.
 */
export function normalizePacket(packet, options = {}) {
  const unwrapped = unwrapPacket(packet, options);
  if (unwrapped) {
    return unwrapped;
  }

  if (options.allowPlain) {
    return { packet, paddingLength: 0, wrapped: false };
  }

  return null;
}

/**
 * Parses the WireGuard message fields needed for endpoint mapping.
 */
export function parseWireGuardPacket(packet) {
  if (!isWireGuardPacket(packet)) {
    return null;
  }

  const type = packet.readUInt32LE(0);
  const parsed = {
    type,
    typeName: wireGuardTypeName(type),
    length: packet.length,
  };

  if (type === 1) {
    parsed.senderIndex = packet.readUInt32LE(4);
  } else if (type === 2) {
    parsed.senderIndex = packet.readUInt32LE(4);
    parsed.receiverIndex = packet.readUInt32LE(8);
  } else if (type === 3 || type === 4) {
    parsed.receiverIndex = packet.readUInt32LE(4);

    if (type === 4 && packet.length >= 16) {
      parsed.counter = packet.readBigUInt64LE(8);
    }
  }

  return parsed;
}

export function isWireGuardPacket(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < 4) {
    return false;
  }

  const type = packet.readUInt32LE(0);
  const minimumLength = MIN_WIREGUARD_LENGTH.get(type);
  return WIREGUARD_TYPES.has(type) && packet.length >= minimumLength;
}

export function formatIndex(index) {
  return `0x${index.toString(16).padStart(8, '0')}`;
}

function startsWith(packet, prefix) {
  if (packet.length < prefix.length) {
    return false;
  }

  for (let index = 0; index < prefix.length; index += 1) {
    if (packet[index] !== prefix[index]) {
      return false;
    }
  }

  return true;
}

function chooseTargetLength(minimumLength, options) {
  if (options.padMin !== undefined || options.padMax !== undefined) {
    const padMin = options.padMin;
    const padMax = options.padMax;

    if (!Number.isInteger(padMin) || !Number.isInteger(padMax) || padMin < 0 || padMax < 0) {
      throw new ProtocolError('padMin and padMax must be non-negative integers');
    }

    if (padMax < padMin) {
      throw new ProtocolError('padMax must be greater than or equal to padMin');
    }

    const selectedLength = padMin === padMax ? padMin : randomInt(padMin, padMax + 1);
    return Math.max(minimumLength, selectedLength);
  }

  const padTo = options.padTo ?? DEFAULT_PAD_TO;
  return Math.max(minimumLength, padTo || minimumLength);
}

function wireGuardTypeName(type) {
  if (type === 1) return 'handshake-initiation';
  if (type === 2) return 'handshake-response';
  if (type === 3) return 'cookie-reply';
  if (type === 4) return 'transport-data';
  return 'unknown';
}
