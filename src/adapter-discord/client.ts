import { createTRPCClient, httpLink, splitLink, httpSubscriptionLink } from '@trpc/client';
import type { AppRouter } from '../daemon/router.js';
import { getSocketPath } from '../shared/workspace.js';
import { createUnixSocketFetch } from '../shared/fetch.js';
import { createUnixSocketEventSource } from '../shared/event-source.js';
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

  const customFetch = createUnixSocketFetch(socketPath);
  const CustomEventSource = createUnixSocketEventSource(socketPath);

  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition(op) {
          return op.type === 'subscription';
        },
        true: httpSubscriptionLink({
          url: 'http://localhost',
          EventSource: CustomEventSource,
        }),
        false: httpLink({
          url: 'http://localhost',
          fetch: customFetch,
        }),
      }),
    ],
  });
}
