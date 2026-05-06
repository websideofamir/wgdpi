#!/usr/bin/env node
import { createClient } from '../src/client.js';
import { parseCliArgs, usage } from '../src/options.js';
import { createServer } from '../src/server.js';

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage());
    return;
  }

  const options = parseCliArgs(process.argv.slice(2));

  if (options.mode === 'client') {
    await createClient(options);
  } else {
    await createServer(options);
  }
}

main().catch((error) => {
  console.error(error.message);
  console.error(usage());
  process.exitCode = 1;
});
