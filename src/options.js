import { DEFAULT_PAD_TO, DEFAULT_PREFIX, MAX_UDP_PAYLOAD } from './protocol.js';

const DEFAULT_LOG_INTERVAL_MS = 60_000;

export function parseCliArgs(argv) {
  const [mode, ...rest] = argv;
  if (!['client', 'server'].includes(mode)) {
    throw new Error('first argument must be either "client" or "server"');
  }

  const flags = parseFlags(rest);
  const padTo = parseIntegerFlag(flags, 'pad-to', DEFAULT_PAD_TO);
  const padMin = parseIntegerFlag(flags, 'pad-min', undefined);
  const padMax = parseIntegerFlag(flags, 'pad-max', undefined);
  const prefix = parsePrefixFlag(flags, 'prefix', DEFAULT_PREFIX);
  const padBytes = parseEnumFlag(flags, 'pad-bytes', 'random', ['random', 'zero']);
  const logIntervalMs = parseIntegerFlag(flags, 'log-interval-ms', DEFAULT_LOG_INTERVAL_MS);

  if ((padMin === undefined) !== (padMax === undefined)) {
    throw new Error('--pad-min and --pad-max must be used together');
  }

  if (padMin !== undefined && padMax < padMin) {
    throw new Error('--pad-max must be greater than or equal to --pad-min');
  }

  if (padMax !== undefined && padMax > MAX_UDP_PAYLOAD) {
    throw new Error(`--pad-max must be less than or equal to ${MAX_UDP_PAYLOAD}`);
  }

  if (mode === 'client') {
    return {
      mode,
      local: parseEndpoint(required(flags, 'listen'), 'listen'),
      remote: parseEndpoint(required(flags, 'remote'), 'remote'),
      remoteBindHost: flags['remote-bind-host'],
      padTo,
      padMin,
      padMax,
      prefix,
      padBytes,
      logIntervalMs,
    };
  }

  return {
    mode,
    listen: parseEndpoint(required(flags, 'listen'), 'listen'),
    wireguard: parseEndpoint(required(flags, 'wireguard'), 'wireguard'),
    wireguardBindHost: flags['wireguard-bind-host'],
    replyMode: flags['reply-mode'] ?? 'plain',
    allowPlainClients: Boolean(flags['allow-plain-clients']),
    endpointTtlMs: parseIntegerFlag(flags, 'endpoint-ttl-ms', undefined),
    padTo,
    padMin,
    padMax,
    prefix,
    padBytes,
    logIntervalMs,
  };
}

export function usage() {
  return `Usage:
  wgwrap client --listen 127.0.0.1:51821 --remote SERVER_IP:9091 [--pad-to 1510]
  wgwrap server --listen 0.0.0.0:9091 --wireguard 127.0.0.1:51820 [--reply-mode plain|wrapped]

Options:
  --listen HOST:PORT           Local UDP listener.
  --remote HOST:PORT           Client mode upstream wrapper endpoint.
  --wireguard HOST:PORT        Server mode local stock WireGuard endpoint.
  --pad-to BYTES               Fixed wrapped UDP payload size. Default: 1510.
  --pad-min BYTES              Minimum random wrapped UDP payload size.
  --pad-max BYTES              Maximum random wrapped UDP payload size.
  --pad-bytes MODE             Padding bytes: random or zero. Default: random.
  --prefix HEX                 4-byte wrapper prefix as 8 hex chars. Default: 00000000.
  --reply-mode MODE            Server replies: plain or wrapped. Default: plain.
  --allow-plain-clients        Server accepts unwrapped client packets too.
  --endpoint-ttl-ms MS         Server endpoint mapping TTL. Default: 180000.
  --log-interval-ms MS         Periodic traffic summary interval. Default: 60000. Use 0 to disable.
`;
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

function parsePrefixFlag(flags, name, fallback) {
  const value = flags[name];
  if (value === undefined) {
    return fallback;
  }

  if (value === true || !/^[0-9a-fA-F]{8}$/.test(value)) {
    throw new Error(`--${name} must be exactly 8 hex characters`);
  }

  return Buffer.from(value, 'hex');
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

function required(flags, name) {
  const value = flags[name];
  if (!value || value === true) {
    throw new Error(`missing --${name}`);
  }

  return value;
}
