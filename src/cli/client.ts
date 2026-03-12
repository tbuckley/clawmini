import { createTRPCClient, httpLink } from '@trpc/client';
import type { UserRouter as AppRouter } from '../daemon/api/index.js';
import { getSocketPath, getClawminiDir } from '../shared/workspace.js';
import { createUnixSocketFetch } from '../shared/fetch.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export async function getDaemonClient(options: { autoStart?: boolean } = {}) {
  const { autoStart = true } = options;
  const socketPath = getSocketPath();

  // Check if server is running by verifying socket exists
  // (A better check would be to ping it, but this is a start)
  if (!fs.existsSync(socketPath)) {
    if (!autoStart) {
      throw new Error('Daemon not running.');
    }
    console.log('Daemon not running. Starting daemon...');

    // Start daemon in the background
    const daemonPath = new URL('../daemon/index.mjs', import.meta.url).pathname;
    const logFile = fs.openSync(path.join(getClawminiDir(), 'daemon.log'), 'a');
    const child = spawn(process.execPath, [daemonPath], {
      detached: true,
      stdio: ['ignore', logFile, logFile],
    });
    child.unref();

    // Wait up to 5 seconds for the daemon to start and create the socket
    for (let i = 0; i < 50; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (fs.existsSync(socketPath)) {
        break;
      }
    }

    if (!fs.existsSync(socketPath)) {
      throw new Error('Failed to start daemon.');
    }
  }

  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: 'http://localhost',
        fetch: createUnixSocketFetch(socketPath),
      }),
    ],
  });
}
