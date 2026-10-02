/** Dedicated local-plugin entry point. Legacy npm 0.1.0 has no such module. */
export async function runPlugin(): Promise<void> {
  const flags = process.argv.slice(2);
  const invalid = flags.find(flag => !['--read-only', '--help', '-h'].includes(flag));
  if (invalid) throw new Error(`Unknown plugin option: ${invalid}`);
  if (flags.includes('--help') || flags.includes('-h')) {
    process.stdout.write('ZeroBoard scoped plugin runtime. Options: --read-only, --help\n');
    return;
  }
  const { runServer } = await import('./server.js');
  await runServer({ plugin: true });
}
