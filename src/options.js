import { DEFAULT_PAD_TO } from './protocol.js';

export function parseCliArgs(argv) {
  const [mode, ...rest] = argv;
  if (!['client', 'server'].includes(mode)) {
    throw new Error('first argument must be either "client" or "server"');
  }

  const flags = parseFlags(rest);
  const padTo = parseIntegerFlag(flags, 'pad-to', DEFAULT_PAD_TO);

  if (mode === 'client') {
    return {
      mode,
      local: parseEndpoint(required(flags, 'listen'), 'listen'),
      remote: parseEndpoint(required(flags, 'remote'), 'remote'),
      remoteBindHost: flags['remote-bind-host'],
      padTo,
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
  --pad-to BYTES               Wrapped UDP payload size. Default: 1510.
  --reply-mode MODE            Server replies: plain or wrapped. Default: plain.
  --allow-plain-clients        Server accepts unwrapped client packets too.
  --endpoint-ttl-ms MS         Server endpoint mapping TTL. Default: 180000.
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

function required(flags, name) {
  const value = flags[name];
  if (!value || value === true) {
    throw new Error(`missing --${name}`);
  }

  return value;
}
