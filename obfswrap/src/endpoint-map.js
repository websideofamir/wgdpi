import { parseWireGuardPacket } from './wireguard.js';

const DEFAULT_TTL_MS = 3 * 60 * 1000;

export class EndpointMap {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.endpoints = new Map();
    this.indexToEndpointKey = new Map();
    this.lastEndpointKey = null;
  }

  registerClientPacket(packet, endpoint, keyId, now = Date.now()) {
    const endpointKey = toEndpointKey(endpoint);
    this.endpoints.set(endpointKey, { ...endpoint, keyId, lastSeen: now });
    this.lastEndpointKey = endpointKey;

    const parsed = parseWireGuardPacket(packet);
    if (parsed?.type === 1) {
      this.indexToEndpointKey.set(parsed.senderIndex, endpointKey);
    }

    this.prune(now);
  }

  resolveServerPacket(packet, now = Date.now()) {
    this.prune(now);

    const parsed = parseWireGuardPacket(packet);
    const receiverIndex = parsed?.receiverIndex;

    if (receiverIndex !== undefined) {
      const endpointKey = this.indexToEndpointKey.get(receiverIndex);
      const endpoint = this.endpoints.get(endpointKey);

      if (endpoint) {
        return endpoint;
      }
    }

    return this.singleEndpoint() ?? this.endpoints.get(this.lastEndpointKey) ?? null;
  }

  prune(now = Date.now()) {
    for (const [endpointKey, endpoint] of this.endpoints.entries()) {
      if (now - endpoint.lastSeen <= this.ttlMs) {
        continue;
      }

      this.endpoints.delete(endpointKey);

      for (const [index, mappedKey] of this.indexToEndpointKey.entries()) {
        if (mappedKey === endpointKey) {
          this.indexToEndpointKey.delete(index);
        }
      }
    }
  }

  singleEndpoint() {
    if (this.endpoints.size !== 1) {
      return null;
    }

    return this.endpoints.values().next().value;
  }
}

export function toEndpointKey(endpoint) {
  return `${endpoint.address}:${endpoint.port}`;
}
