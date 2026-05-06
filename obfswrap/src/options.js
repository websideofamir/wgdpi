import { MAX_KEY_ID } from './key-derivation.js';
import { MAX_UDP_PAYLOAD } from './protocol.js';

const DEFAULT_LOG_INTERVAL_MS = 60_000;

export function parseCliArgs(argv) {
  const [mode, ...rest] = argv;
  if (!['client', 'server'].includes(mode)) {
    throw new Error('first argument must be either "client" or "server"');
  }

  const flags = parseFlags(rest);
  const common = parseCommonOptions(flags);

  if (mode === 'client') {
    return {
      mode,
      local: parseEndpoint(required(flags, 'listen'), 'listen'),
      remote: parseEndpoint(required(flags, 'remote'), 'remote'),
      remoteBindHost: flags['remote-bind-host'],
      keyId: parseKeyId(required(flags, 'key-id'), 'key-id'),
      ...common,
    };
  }

  return {
    mode,
    listen: parseEndpoint(required(flags, 'listen'), 'listen'),
    wireguard: parseEndpoint(required(flags, 'wireguard'), 'wireguard'),
    wireguardBindHost: flags['wireguard-bind-host'],
    endpointTtlMs: parseIntegerFlag(flags, 'endpoint-ttl-ms', undefined),
    ...common,
  };
}

export function parseGeneratorArgs(argv) {
  const flags = parseFlags(argv);
  return {
    seedHex: required(flags, 'seed-hex'),
    salt: required(flags, 'salt'),
    count: parseIntegerFlag(flags, 'count', undefined),
    start: parseKeyId(flags.start ?? '0', 'start'),
    out: flags.out,
  };
}

export function usage() {
  return `Usage:
  obfswrap client --listen 127.0.0.1:51821 --remote SERVER_IP:9091 --key-id 999999 (--secrets PATH | --seed-hex HEX --salt TEXT)
  obfswrap server --listen 0.0.0.0:9091 --wireguard 127.0.0.1:51820 (--secrets PATH | --seed-hex HEX --salt TEXT)

Packet format:
  [key_id:3] [nonce:12] [ciphertext] [tag:8]

Options:
  --listen HOST:PORT           UDP listener.
  --remote HOST:PORT           Client mode upstream obfswrap endpoint.
  --wireguard HOST:PORT        Server mode local stock WireGuard endpoint.
  --key-id ID                  Client mode 3-byte secret index, 0-${MAX_KEY_ID}.
  --secrets PATH               Secret list file, one 32-byte hex secret per line.
  --seed-hex HEX               32-byte hex seed for deterministic on-demand secrets.
  --salt TEXT                  Non-empty deployment salt used with --seed-hex.
  --pad-to BYTES               Fixed public UDP payload size. Default: no padding.
  --pad-mode MODE              Padding mode: all or handshake. Default: all.
  --endpoint-ttl-ms MS         Server endpoint mapping TTL. Default: 180000.
  --log-interval-ms MS         Periodic traffic summary interval. Default: 60000. Use 0 to disable.
`;
}

export function generatorUsage() {
  return `Usage:
  generate-secrets --seed-hex HEX --salt TEXT --count COUNT [--start ID] [--out PATH]

Options:
  --seed-hex HEX               32-byte hex seed shared by client and server.
  --salt TEXT                  Non-empty deployment salt.
  --count COUNT                Number of secrets to generate.
  --start ID                   First 3-byte key_id to generate. Default: 0.
  --out PATH                   Output file. Defaults to stdout.
`;
}

function parseCommonOptions(flags) {
  const secretsPath = flags.secrets;
  const seedHex = flags['seed-hex'];
  const salt = flags.salt;

  if (secretsPath && (seedHex || salt)) {
    throw new Error('use either --secrets or --seed-hex with --salt, not both');
  }

  if (!secretsPath && (!seedHex || !salt)) {
    throw new Error('missing secret source; use --secrets or --seed-hex with --salt');
  }

  return {
    secretsPath,
    seedHex,
    salt,
    padTo: parsePadTo(flags),
    padMode: parseEnumFlag(flags, 'pad-mode', 'all', ['all', 'handshake']),
    logIntervalMs: parseIntegerFlag(flags, 'log-interval-ms', DEFAULT_LOG_INTERVAL_MS),
  };
}

function parseFlags(args) {
  const flags = {};

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      throw new Error(`unexpected argument: ${token}`);
    }

    const [rawName, inlineValue] = token.slice(2).split('=', 2);
    const nextValue = args[index + 1];

    if (inlineValue !== undefined) {
      flags[rawName] = inlineValue;
    } else if (!nextValue || nextValue.startsWith('--')) {
      flags[rawName] = true;
    } else {
      flags[rawName] = nextValue;
      index += 1;
    }
  }

  return flags;
}

function parseEndpoint(value, flagName) {
  const separatorIndex = value.lastIndexOf(':');
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw new Error(`--${flagName} must be in HOST:PORT format`);
  }

  const host = value.slice(0, separatorIndex);
  const port = Number(value.slice(separatorIndex + 1));

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`--${flagName} has an invalid port`);
  }

  return { host, port };
}

function parseIntegerFlag(flags, name, fallback) {
  if (flags[name] === undefined) {
    return fallback;
  }

  const value = Number(flags[name]);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }

  return value;
}

function parsePadTo(flags) {
  const padTo = parseIntegerFlag(flags, 'pad-to', 0);

  if (padTo > MAX_UDP_PAYLOAD) {
    throw new Error(`--pad-to must be less than or equal to ${MAX_UDP_PAYLOAD}`);
  }

  return padTo;
}

function parseEnumFlag(flags, name, fallback, allowedValues) {
  const value = flags[name];
  if (value === undefined) {
    return fallback;
  }

  if (value === true || !allowedValues.includes(value)) {
    throw new Error(`--${name} must be one of: ${allowedValues.join(', ')}`);
  }

  return value;
}

function parseKeyId(value, flagName) {
  const keyId = Number(value);
  if (!Number.isInteger(keyId) || keyId < 0 || keyId > MAX_KEY_ID) {
    throw new Error(`--${flagName} must be an integer between 0 and ${MAX_KEY_ID}`);
  }

  return keyId;
}

function required(flags, name) {
  const value = flags[name];
  if (value === undefined || value === true || value === '') {
    throw new Error(`missing --${name}`);
  }

  return value;
}
