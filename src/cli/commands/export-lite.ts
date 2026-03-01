import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';

const liteScriptContent = `#!/usr/bin/env node
/**
 * clawmini-lite - A standalone zero-dependency client
 */
const API_URL = process.env.CLAW_API_URL;
const API_TOKEN = process.env.CLAW_API_TOKEN;

async function main() {
  if (!API_URL || !API_TOKEN) {
    console.error('CLAW_API_URL and CLAW_API_TOKEN must be set in the environment.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const cmd = args[0];

  async function trpcCall(endpoint, method = 'POST', input = undefined) {
    let url = \`\${API_URL}/\${endpoint}\`;
    const options = {
      method,
      headers: {
        'Authorization': \`Bearer \${API_TOKEN}\`,
        'Content-Type': 'application/json',
      },
    };

    if (method === 'GET') {
      if (input !== undefined) {
        url += \`?batch=1&input=\${encodeURIComponent(JSON.stringify({ "0": input }))}\`;
      }
    } else {
      if (input !== undefined) {
        options.body = JSON.stringify(input);
      }
    }

    const res = await fetch(url, options);
    const text = await res.text();
    let data;
    try {
      data = JSON.stringify(JSON.parse(text), null, 2);
      data = JSON.parse(text);
    } catch {
      throw new Error(\`Failed to parse response: \${text}\`);
    }

    if (!res.ok) {
      const isBatched = method === 'GET';
      const errMsg = (isBatched ? data?.[0]?.error?.message : data?.error?.message) || \`HTTP \${res.status} \${res.statusText}\`;
      throw new Error(errMsg);
    }
    
    if (method === 'GET') {
      return data[0].result.data;
    }
    return data.result.data;
  }

  function parseArgs(argsList) {
    const opts = { env: [] };
    const positional = [];
    for (let i = 0; i < argsList.length; i++) {
      const arg = argsList[i];
      if (arg.startsWith('--')) {
        const key = arg.slice(2);
        opts[key] = argsList[++i];
      } else if (arg.startsWith('-')) {
        const key = arg.slice(1);
        if (key === 'e' || key === 'env') {
          opts.env.push(argsList[++i]);
        } else {
          opts[key] = argsList[++i];
        }
      } else {
        positional.push(arg);
      }
    }
    return { opts, positional };
  }

  try {
    if (cmd === 'log') {
      const message = args.slice(1).join(' ');
      if (!message) {
        console.error('Usage: clawmini-lite log <message>');
        process.exit(1);
      }
      await trpcCall('logMessage', 'POST', { message });
      console.log('Log message appended.');
    } else if (cmd === 'jobs') {
      const subcmd = args[1];
      if (subcmd === 'list') {
        const jobs = await trpcCall('listCronJobs', 'GET', {});
        console.log(JSON.stringify(jobs, null, 2));
      } else if (subcmd === 'add') {
        const { opts, positional } = parseArgs(args.slice(2));
        const name = positional[0];
        if (!name) {
          console.error('Usage: clawmini-lite jobs add <name> [options]');
          process.exit(1);
        }
        
        let schedule;
        if (opts.at) schedule = { at: opts.at };
        else if (opts.every) schedule = { every: opts.every };
        else if (opts.cron) schedule = { cron: opts.cron };
        else throw new Error('A schedule must be specified (--at, --every, or --cron).');

        const job = {
          id: name,
          createdAt: new Date().toISOString(),
          message: opts.message || opts.m || '',
          schedule,
        };

        if (opts.reply || opts.r) job.reply = opts.reply || opts.r;
        if (opts.agent || opts.a) job.agentId = opts.agent || opts.a;
        if (opts.session || opts.s) {
          if ((opts.session || opts.s) !== 'new') throw new Error('Only "new" session type is supported.');
          job.session = { type: 'new' };
        }
        
        const envArgs = opts.env;
        if (envArgs && envArgs.length > 0) {
          job.env = {};
          for (const e of envArgs) {
            const [k, ...v] = e.split('=');
            if (k) job.env[k] = v.join('=');
          }
        }

        const chatId = opts.chat || opts.c;
        await trpcCall('addCronJob', 'POST', { chatId, job });
        console.log(\`Job '\${name}' created successfully.\`);
      } else if (subcmd === 'delete') {
        const { opts, positional } = parseArgs(args.slice(2));
        const name = positional[0];
        if (!name) {
          console.error('Usage: clawmini-lite jobs delete <name>');
          process.exit(1);
        }
        const chatId = opts.chat || opts.c;
        const result = await trpcCall('deleteCronJob', 'POST', { chatId, id: name });
        if (result && result.deleted) {
          console.log(\`Job '\${name}' deleted successfully.\`);
        } else {
          console.log(\`Job '\${name}' not found.\`);
        }
      } else {
        console.error('Unknown jobs subcommand. Supported: list, add, delete');
        process.exit(1);
      }
    } else {
      console.error('Unknown command. Supported: log, jobs');
      process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
`;

export const exportLiteCmd = new Command('export-lite')
  .description('Export the standalone clawmini-lite client script')
  .option(
    '-o, --out <path>',
    'Output path or directory for the script (defaults to current directory)'
  )
  .option('--stdout', 'Output the script to stdout instead of a file')
  .action(async (options: { out?: string; stdout?: boolean }) => {
    if (options.stdout) {
      process.stdout.write(liteScriptContent);
      return;
    }

    const defaultFilename = 'clawmini-lite.js';
    let finalPath = path.resolve(process.cwd(), defaultFilename);

    if (options.out) {
      try {
        const stats = await fs.stat(options.out);
        if (stats.isDirectory()) {
          finalPath = path.resolve(options.out, defaultFilename);
        } else {
          finalPath = path.resolve(options.out);
        }
      } catch {
        // Path doesn't exist, assume it's a file path
        finalPath = path.resolve(options.out);
      }
    }

    try {
      await fs.writeFile(finalPath, liteScriptContent, { mode: 0o755 });
      console.log(`Successfully exported clawmini-lite to ${finalPath}`);
    } catch (err) {
      console.error(`Failed to export script: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });
