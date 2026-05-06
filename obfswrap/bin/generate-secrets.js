#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';

import { MAX_KEY_ID, deriveSecret, parseSeedHex } from '../src/key-derivation.js';
import { generatorUsage, parseGeneratorArgs } from '../src/options.js';

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(generatorUsage());
    return;
  }

  const options = parseGeneratorArgs(process.argv.slice(2));
  if (!Number.isInteger(options.count) || options.count <= 0) {
    throw new Error('--count must be a positive integer');
  }

  if (options.start + options.count - 1 > MAX_KEY_ID) {
    throw new Error(`requested range exceeds max key_id ${MAX_KEY_ID}`);
  }

  const seed = parseSeedHex(options.seedHex);
  const output = options.out ? createWriteStream(options.out, { mode: 0o600 }) : process.stdout;

  for (let offset = 0; offset < options.count; offset += 1) {
    const keyId = options.start + offset;
    const line = `${deriveSecret(seed, options.salt, keyId).toString('hex')}\n`;

    if (!output.write(line)) {
      await once(output, 'drain');
    }
  }

  if (options.out) {
    output.end();
    await once(output, 'finish');
  }
}

main().catch((error) => {
  console.error(error.message);
  console.error(generatorUsage());
  process.exitCode = 1;
});
