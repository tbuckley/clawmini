import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';

import { getClawminiDir } from '../../shared/workspace.js';

const SERVICE_ALIASES: Record<string, string> = {
  daemon: 'daemon',
  web: 'web',
  discord: 'adapter-discord',
  'adapter-discord': 'adapter-discord',
  'google-chat': 'adapter-google-chat',
  'adapter-google-chat': 'adapter-google-chat',
  supervisor: 'supervisor',
};

function displayNameFor(logBase: string): string {
  if (logBase.startsWith('adapter-')) return logBase.slice('adapter-'.length);
  return logBase;
}

function tailString(content: string, n: number): string[] {
  const lines = content.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-n);
}

interface LogsOptions {
  follow?: boolean;
  service?: string;
  lines?: string;
}

export const logsCmd = new Command('logs')
  .description('View logs from clawmini services (daemon, web, adapters)')
  .option('-f, --follow', 'Follow the logs as new lines are written')
  .option(
    '-s, --service <name>',
    'Restrict to one service: daemon, web, discord, google-chat, supervisor'
  )
  .option('-n, --lines <count>', 'Number of lines to show from the tail of each file', '50')
  .action(async (options: LogsOptions) => {
    const logDir = path.join(getClawminiDir(), 'logs');
    if (!fs.existsSync(logDir)) {
      console.error(`No log directory at ${logDir}. Start the supervisor with 'clawmini serve'.`);
      process.exit(1);
    }

    let targets: string[];
    if (options.service) {
      const resolved = SERVICE_ALIASES[options.service];
      if (!resolved) {
        console.error(
          `Unknown service '${options.service}'. Valid: ${Object.keys(SERVICE_ALIASES).join(', ')}`
        );
        process.exit(1);
      }
      targets = [`${resolved}.log`];
    } else {
      targets = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
    }

    const linesCount = Math.max(0, parseInt(options.lines ?? '50', 10) || 50);

    for (const file of targets) {
      const full = path.join(logDir, file);
      if (!fs.existsSync(full)) continue;
      const prefix = `[${displayNameFor(file.replace(/\.log$/, ''))}] `;
      const content = fs.readFileSync(full, 'utf-8');
      for (const line of tailString(content, linesCount)) {
        process.stdout.write(prefix + line + '\n');
      }
    }

    if (!options.follow) return;

    const watched: Array<{ file: string; full: string; prefix: string; position: number }> = [];
    for (const file of targets) {
      const full = path.join(logDir, file);
      const prefix = `[${displayNameFor(file.replace(/\.log$/, ''))}] `;
      const position = fs.existsSync(full) ? fs.statSync(full).size : 0;
      watched.push({ file, full, prefix, position });
      fs.watchFile(full, { interval: 500 }, (curr) => {
        const entry = watched.find((w) => w.full === full);
        if (!entry) return;
        if (curr.size < entry.position) {
          entry.position = 0;
        }
        if (curr.size > entry.position) {
          const fd = fs.openSync(full, 'r');
          const buf = Buffer.alloc(curr.size - entry.position);
          fs.readSync(fd, buf, 0, buf.length, entry.position);
          fs.closeSync(fd);
          entry.position = curr.size;

          const text = buf.toString();
          const lines = text.split('\n');
          if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
          for (const line of lines) {
            process.stdout.write(entry.prefix + line + '\n');
          }
        }
      });
    }

    const stop = () => {
      for (const entry of watched) fs.unwatchFile(entry.full);
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);

    await new Promise<void>(() => {
      /* intentionally unresolved; signals drive termination */
    });
  });
