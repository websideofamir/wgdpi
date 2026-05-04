#!/usr/bin/env node
import { createClientWrapper } from '../src/client-wrapper.js';
import { createServerWrapper } from '../src/server-wrapper.js';
import { parseCliArgs, usage } from '../src/options.js';

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage());
    return;
  }

  const options = parseCliArgs(process.argv.slice(2));

  if (options.mode === 'client') {
    await createClientWrapper(options);
  } else {
    await createServerWrapper(options);
  }
}

main().catch((error) => {
  console.error(error.message);
  console.error(usage());
  process.exitCode = 1;
});
