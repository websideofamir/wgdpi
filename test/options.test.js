import { describe, expect, it } from 'vitest';

import { parseCliArgs } from '../src/options.js';

describe('parseCliArgs', () => {
  it('parses random padding range and custom prefix for client mode', () => {
    const options = parseCliArgs([
      'client',
      '--listen', '127.0.0.1:51821',
      '--remote', '203.0.113.10:9091',
      '--pad-min', '900',
      '--pad-max', '1280',
      '--pad-bytes', 'zero',
      '--prefix', '7a21c90e',
    ]);

    expect(options).toMatchObject({
      mode: 'client',
      padMin: 900,
      padMax: 1280,
      padBytes: 'zero',
      local: { host: '127.0.0.1', port: 51821 },
      remote: { host: '203.0.113.10', port: 9091 },
    });
    expect(options.prefix).toEqual(Buffer.from('7a21c90e', 'hex'));
  });

  it('requires pad-min and pad-max to be used together', () => {
    expect(() => parseCliArgs([
      'server',
      '--listen', '0.0.0.0:9091',
      '--wireguard', '127.0.0.1:51820',
      '--pad-min', '900',
    ])).toThrow('--pad-min and --pad-max must be used together');
  });

  it('validates custom prefix length and characters', () => {
    expect(() => parseCliArgs([
      'client',
      '--listen', '127.0.0.1:51821',
      '--remote', '203.0.113.10:9091',
      '--prefix', 'bad',
    ])).toThrow('--prefix must be exactly 8 hex characters');
  });

  it('rejects impossible random padding ranges', () => {
    expect(() => parseCliArgs([
      'client',
      '--listen', '127.0.0.1:51821',
      '--remote', '203.0.113.10:9091',
      '--pad-min', '1280',
      '--pad-max', '900',
    ])).toThrow('--pad-max must be greater than or equal to --pad-min');
  });

  it('validates padding byte mode', () => {
    expect(() => parseCliArgs([
      'client',
      '--listen', '127.0.0.1:51821',
      '--remote', '203.0.113.10:9091',
      '--pad-bytes', 'garbage',
    ])).toThrow('--pad-bytes must be one of: random, zero');
  });
});
