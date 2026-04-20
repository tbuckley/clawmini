#!/usr/bin/env node
import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const runHostCmd = new Command('run-host');

runHostCmd
  .description('Run an arbitrary shell command on the host via `sh -c`.')
  .requiredOption(
    '--command <command_string>',
    'The shell command to execute. Supports pipes, redirection, &&, ||, etc.'
  )
  .addHelpText(
    'after',
    `
Examples:
  1. Run a simple command:
     clawmini-lite request run-host -- --command "ls -la"

  2. Run a command with pipes and redirection:
     clawmini-lite request run-host -- --command "cat file.txt | grep error > errors.log"

  3. Chain commands:
     clawmini-lite request run-host -- --command "npm install && npm test"
`
  )
  .action((options: { command: string }) => {
    const child = spawn('sh', ['-c', options.command], {
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      process.exit(code ?? 1);
    });

    child.on('error', (err) => {
      console.error(`Failed to execute command: ${err.message}`);
      process.exit(1);
    });
  });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHostCmd.parse(process.argv);
}
