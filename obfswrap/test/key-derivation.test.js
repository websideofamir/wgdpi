import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createListSecretResolver,
  deriveSecret,
  loadSecretList,
  parseSeedHex,
} from '../src/key-derivation.js';

const seedHex = '9f2b7c4a81d3e0b7f5a60d9a3c11e274ba69cd04f43a830611e09db2320f91aa';

describe('secret derivation', () => {
  it('derives deterministic 32-byte secrets from seed, salt, and key_id', () => {
    const seed = parseSeedHex(seedHex);
    const first = deriveSecret(seed, 'salt-a', 999_999);
    const second = deriveSecret(seed, 'salt-a', 999_999);
    const different = deriveSecret(seed, 'salt-a', 1_000_000);

    expect(first).toHaveLength(32);
    expect(first).toEqual(second);
    expect(first).not.toEqual(different);
  });

  it('loads one hex secret per line into a contiguous list', () => {
    const dir = mkdtempSync(join(tmpdir(), 'obfswrap-'));
    const file = join(dir, 'secrets.txt');
    const seed = parseSeedHex(seedHex);
    const secret0 = deriveSecret(seed, 'salt-b', 0).toString('hex');
    const secret1 = deriveSecret(seed, 'salt-b', 1).toString('hex');

    try {
      writeFileSync(file, `# comment\n${secret0}\n\n${secret1}\n`);

      const list = loadSecretList(file);
      expect(list).toHaveLength(64);

      const resolver = createListSecretResolver({ secretsPath: file });
      expect(resolver.size).toBe(2);
      expect(resolver.get(0).toString('hex')).toBe(secret0);
      expect(resolver.get(1).toString('hex')).toBe(secret1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
