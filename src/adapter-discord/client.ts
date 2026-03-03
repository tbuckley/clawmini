import { createTRPCClient, httpLink } from '@trpc/client';
import type { AppRouter } from '../daemon/router.js';
import { getSocketPath } from '../shared/workspace.js';
import { createUnixSocketFetch } from '../shared/fetch.js';
import fs from 'node:fs';

/**
 * Creates a TRPC client that connects to the Clawmini daemon via a Unix socket.
 *
 * @param options - Configuration options for the client.
 * @returns A TRPC client instance for the AppRouter.
 */
export function getTRPCClient(options: { socketPath?: string } = {}) {
  const socketPath = options.socketPath ?? getSocketPath();

  if (!fs.existsSync(socketPath)) {
    throw new Error(`Daemon not running. Socket not found at ${socketPath}`);
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
