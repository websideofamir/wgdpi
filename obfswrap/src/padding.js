import { parseWireGuardPacket } from './wireguard.js';

export function paddingForPacket(packet, options) {
  const padTo = options.padTo ?? 0;
  if (!padTo) {
    return 0;
  }

  const padMode = options.padMode ?? 'all';
  if (padMode === 'all') {
    return padTo;
  }

  const parsed = parseWireGuardPacket(packet);
  return parsed && parsed.type !== 4 ? padTo : 0;
}

export function paddingDescription(options) {
  const padTo = options.padTo ?? 0;
  if (!padTo) {
    return 'padding=none';
  }

  const padMode = options.padMode ?? 'all';
  return `fixed padding length ${padTo}, pad mode ${padMode}`;
}
