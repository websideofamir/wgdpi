import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const KEY_ID_BYTES = 3;
export const MAX_KEY_ID = 0xffffff;
export const SECRET_BYTES = 32;

const DERIVATION_CONTEXT = Buffer.from('obfswrap-secret-v1', 'utf8');

export class SecretError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SecretError';
  }
}

export function assertKeyId(keyId) {
  if (!Number.isInteger(keyId) || keyId < 0 || keyId > MAX_KEY_ID) {
    throw new SecretError(`key_id must be an integer between 0 and ${MAX_KEY_ID}`);
  }
}

export function encodeKeyId(keyId) {
  assertKeyId(keyId);
  const encoded = Buffer.alloc(KEY_ID_BYTES);
  encoded.writeUIntBE(keyId, 0, KEY_ID_BYTES);
  return encoded;
}

export function decodeKeyId(packet, offset = 0) {
  if (!Buffer.isBuffer(packet) || packet.length < offset + KEY_ID_BYTES) {
    throw new SecretError('packet is too short to contain a 3-byte key_id');
  }

  return packet.readUIntBE(offset, KEY_ID_BYTES);
}

export function parseSeedHex(seedHex) {
  if (typeof seedHex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(seedHex)) {
    throw new SecretError('--seed-hex must be exactly 64 hex characters (32 bytes)');
  }

  return Buffer.from(seedHex, 'hex');
}

export function deriveSecret(seed, salt, keyId) {
  if (!Buffer.isBuffer(seed) || seed.length !== SECRET_BYTES) {
    throw new SecretError('seed must be exactly 32 bytes');
  }

  if (typeof salt !== 'string' || salt.length === 0) {
    throw new SecretError('salt must be a non-empty string');
  }

  const keyIdBytes = encodeKeyId(keyId);
  return createHmac('sha256', seed)
    .update(DERIVATION_CONTEXT)
    .update(Buffer.from([0]))
    .update(Buffer.from(salt, 'utf8'))
    .update(Buffer.from([0]))
    .update(keyIdBytes)
    .digest();
}

export function createDerivedSecretResolver({ seedHex, salt }) {
  const seed = parseSeedHex(seedHex);

  if (typeof salt !== 'string' || salt.length === 0) {
    throw new SecretError('--salt must be a non-empty string');
  }

  return {
    type: 'derived',
    size: MAX_KEY_ID + 1,
    get(keyId) {
      return deriveSecret(seed, salt, keyId);
    },
  };
}

export function loadSecretList(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new SecretError('--secrets must be a file path');
  }

  const text = readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const secrets = [];

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber].trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    if (!/^[0-9a-fA-F]{64}$/.test(line)) {
      throw new SecretError(`invalid secret at ${filePath}:${lineNumber + 1}; expected 64 hex characters`);
    }

    secrets.push(Buffer.from(line, 'hex'));
  }

  if (secrets.length === 0) {
    throw new SecretError('secret list is empty');
  }

  if (secrets.length > MAX_KEY_ID + 1) {
    throw new SecretError(`secret list has more than ${MAX_KEY_ID + 1} entries`);
  }

  return Buffer.concat(secrets);
}

export function createListSecretResolver({ secretsPath }) {
  const secrets = loadSecretList(secretsPath);
  const size = secrets.length / SECRET_BYTES;

  return {
    type: 'list',
    size,
    get(keyId) {
      assertKeyId(keyId);

      if (keyId >= size) {
        throw new SecretError(`unknown key_id ${keyId}; secret list has ${size} entries`);
      }

      const offset = keyId * SECRET_BYTES;
      return secrets.subarray(offset, offset + SECRET_BYTES);
    },
  };
}

export function createSecretResolver(options) {
  const hasList = Boolean(options.secretsPath);
  const hasDerived = options.seedHex !== undefined || options.salt !== undefined;

  if (hasList === hasDerived) {
    throw new SecretError('use either --secrets or --seed-hex with --salt');
  }

  if (hasList) {
    return createListSecretResolver(options);
  }

  if (!options.seedHex || !options.salt) {
    throw new SecretError('--seed-hex and --salt must be used together');
  }

  return createDerivedSecretResolver(options);
}
