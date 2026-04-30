#!/usr/bin/env node
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    `run-with-network: Run a command with network access via cladding's sandbox.\n` +
      `\n` +
      `Usage:\n` +
      `  run-with-network --command "<shell command>"\n` +
      `\n` +
      `The command string is forwarded to \`sh -c\` inside the cladding sandbox,\n` +
      `so it supports pipes, redirection, &&, ||, environment variables, multiple\n` +
      `commands, etc.\n` +
      `\n` +
      `Examples:\n` +
      `  run-with-network --command "curl -sSL https://example.com | jq ."\n` +
      `  run-with-network --command "FOO=1 echo \\$FOO"\n` +
      `  run-with-network --command 'echo "hello" && echo "world"'\n`
  );
  process.exit(0);
}

const idx = args.indexOf('--command');
if (idx === -1 || idx + 1 >= args.length) {
  process.stderr.write(
    `Error: --command <shell command> is required.\n` +
      `Usage: run-with-network --command "<shell command>"\n`
  );
  process.exit(2);
}
const command = args[idx + 1];

// `cladding run-with-scissors` execs its argv directly inside the sandbox, so
// shell features (env-var prefixes, &&, pipes, multi-line) only work if we
// hand it an explicit shell. Wrap in `sh -c` so the user's command string is
// parsed as a script.
const child = spawn('cladding', ['run-with-scissors', 'sh', '-c', command], {
  stdio: ['ignore', 'inherit', 'inherit'],
});

child.on('close', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  process.stderr.write(`Failed to execute command: ${err.message}\n`);
  process.exit(1);
});
