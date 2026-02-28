import http from 'node:http';
import fs from 'node:fs';
import { createHTTPHandler } from '@trpc/server/adapters/standalone';
import { appRouter } from './router.js';
import { getSocketPath, getClawminiDir } from '../shared/workspace.js';
import { cronManager } from './cron.js';

export function initDaemon() {
  const socketPath = getSocketPath();
  const clawminiDir = getClawminiDir();

  // Ensure the .clawmini directory exists
  if (!fs.existsSync(clawminiDir)) {
    throw new Error(`${clawminiDir} does not exist`);
  }

  // Initialize cron jobs
  cronManager.init().catch((err) => {
    console.error('Failed to initialize cron manager:', err);
  });

  // Ensure the old socket file is removed
  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
  }

  const handler = createHTTPHandler({
    router: appRouter,
    createContext: () => ({}),
  });

  const server = http.createServer((req, res) => {
    // Only accept POST requests on /trpc/ path if needed, but since we are running over Unix socket, we map directly
    handler(req, res);
  });

  server.listen(socketPath, () => {
    console.log(`Daemon initialized and listening on ${socketPath}`);
  });

  process.on('SIGINT', () => {
    server.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    server.close();
    process.exit(0);
  });

  process.on('exit', () => {
    if (fs.existsSync(socketPath)) {
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // Ignore errors during exit cleanup
      }
    }
  });
}

// Only auto-initialize if run directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  initDaemon();
}
