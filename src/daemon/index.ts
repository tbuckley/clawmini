import http from 'node:http';
import fs from 'node:fs';
import { createHTTPHandler } from '@trpc/server/adapters/standalone';
import { appRouter } from './router.js';
import { getSocketPath, getClawminiDir, getSettingsPath } from '../shared/workspace.js';
import { cronManager } from './cron.js';
import { SettingsSchema } from '../shared/config.js';
import { validateToken, getApiContext } from './auth.js';

export function initDaemon() {
  const socketPath = getSocketPath();
  const clawminiDir = getClawminiDir();

  // Ensure the .clawmini directory exists
  if (!fs.existsSync(clawminiDir)) {
    throw new Error(`${clawminiDir} does not exist`);
  }

  // Read settings to check if API is enabled
  const settingsPath = getSettingsPath();
  let apiCtx: ReturnType<typeof getApiContext> = null;

  if (fs.existsSync(settingsPath)) {
    try {
      const settingsStr = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(settingsStr);
      const parsed = SettingsSchema.safeParse(settings);
      if (parsed.success) {
        apiCtx = getApiContext(parsed.data);
      }
    } catch (err) {
      console.warn(`Failed to read or parse settings from ${settingsPath}:`, err);
    }
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
    createContext: ({ req, res }) => ({ req, res, isApiServer: false }),
  });

  const server = http.createServer((req, res) => {
    // Only accept POST requests on /trpc/ path if needed, but since we are running over Unix socket, we map directly
    handler(req, res);
  });

  server.listen(socketPath, () => {
    console.log(`Daemon initialized and listening on ${socketPath}`);
  });

  let apiServer: http.Server | undefined;
  if (apiCtx) {
    const apiHandler = createHTTPHandler({
      router: appRouter,
      createContext: ({ req, res }) => {
        let tokenPayload = null;
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.substring(7);
          tokenPayload = validateToken(token);
        }
        return { req, res, isApiServer: true, tokenPayload };
      },
    });

    apiServer = http.createServer((req, res) => {
      apiHandler(req, res);
    });

    const host = apiCtx.host;
    const port = apiCtx.port;
    apiServer.listen(port, host, () => {
      console.log(`Daemon HTTP API initialized and listening on http://${host}:${port}`);
    });
  }

  process.on('SIGINT', () => {
    server.close();
    if (apiServer) apiServer.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    server.close();
    if (apiServer) apiServer.close();
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
