import { describe, expect, it } from 'vitest';

import { parseCliArgs, parseGeneratorArgs } from '../src/options.js';

const seedHex = '9f2b7c4a81d3e0b7f5a60d9a3c11e274ba69cd04f43a830611e09db2320f91aa';

describe('obfswrap options', () => {
  it('parses client options with derived secrets', () => {
    const options = parseCliArgs([
      'client',
      '--listen', '127.0.0.1:51821',
      '--remote', '1.2.3.4:9091',
      '--seed-hex', seedHex,
      '--salt', 'profile',
      '--key-id', '999999',
      '--pad-to', '1510',
      '--pad-mode', 'handshake',
    ]);

    expect(options.mode).toBe('client');
    expect(options.keyId).toBe(999_999);
    expect(options.local).toEqual({ host: '127.0.0.1', port: 51821 });
    expect(options.remote).toEqual({ host: '1.2.3.4', port: 9091 });
    expect(options.padTo).toBe(1510);
    expect(options.padMode).toBe('handshake');
  });

  it('parses server options with secret list', () => {
    const options = parseCliArgs([
      'server',
      '--listen', '0.0.0.0:9091',
      '--wireguard', '127.0.0.1:51820',
      '--secrets', './secrets.txt',
    ]);

    expect(options.mode).toBe('server');
    expect(options.listen).toEqual({ host: '0.0.0.0', port: 9091 });
    expect(options.wireguard).toEqual({ host: '127.0.0.1', port: 51820 });
    expect(options.secretsPath).toBe('./secrets.txt');
  });

  it('requires exactly one secret source', () => {
    expect(() => parseCliArgs(['server', '--listen', '0.0.0.0:9091', '--wireguard', '127.0.0.1:51820'])).toThrow('missing secret source');
    expect(() => parseCliArgs([
      'server', '--listen', '0.0.0.0:9091', '--wireguard', '127.0.0.1:51820',
      '--secrets', './secrets.txt', '--seed-hex', seedHex, '--salt', 'profile',
    ])).toThrow('use either --secrets or --seed-hex');
  });

  it('parses generator options', () => {
    const options = parseGeneratorArgs([
      '--seed-hex', seedHex,
      '--salt', 'profile',
      '--count', '1000000',
      '--start', '999999',
      '--out', 'secrets.txt',
    ]);

    expect(options.count).toBe(1_000_000);
    expect(options.start).toBe(999_999);
    expect(options.out).toBe('secrets.txt');
  });
});
