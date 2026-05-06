const WIREGUARD_TYPES = new Set([1, 2, 3, 4]);
const MIN_WIREGUARD_LENGTH = new Map([
  [1, 148],
  [2, 92],
  [3, 64],
  [4, 32],
]);

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

function wireGuardTypeName(type) {
  if (type === 1) return 'handshake-initiation';
  if (type === 2) return 'handshake-response';
  if (type === 3) return 'cookie-reply';
  if (type === 4) return 'transport-data';
  return 'unknown';
}
