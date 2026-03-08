import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { createHTTPHandler } from '@trpc/server/adapters/standalone';
import { appRouter } from './router.js';
import {
  getSocketPath,
  getClawminiDir,
  getSettingsPath,
  readSettings,
  readEnvironment,
  getEnvironmentPath,
  getWorkspaceRoot,
} from '../shared/workspace.js';
import { cronManager } from './cron.js';
import { SettingsSchema } from '../shared/config.js';
import { validateToken, getApiContext } from './auth.js';
import path from 'node:path';

export async function initDaemon() {
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

  const runHooks = async (hookType: 'up' | 'down') => {
    try {
      const currentSettings = await readSettings();
      const workspaceRoot = getWorkspaceRoot(process.cwd());
      if (!currentSettings?.environments) return;
      for (const [envPath, envName] of Object.entries(currentSettings.environments)) {
        try {
          const envConfig = await readEnvironment(envName);
          const command = envConfig?.[hookType];
          if (command) {
            console.log(`Executing '${hookType}' hook for environment '${envName}': ${command}`);
            const envDir = getEnvironmentPath(envName);
            const affectedDir = path.resolve(workspaceRoot, envPath);
            execSync(command, {
              cwd: affectedDir,
              stdio: 'inherit',
              env: { ...process.env, ENV_DIR: envDir },
              timeout: hookType === 'down' ? 10000 : undefined,
            });
          }
        } catch (err) {
          console.error(`Failed to execute '${hookType}' hook for environment '${envName}':`, err);
          if (hookType === 'up') throw err;
        }
      }
    } catch (err) {
      console.error(`Failed to run '${hookType}' hooks:`, err);
      if (hookType === 'up') throw err;
    }
  };

  // Ensure the old socket file is removed, but first check if another daemon is actively listening
  if (fs.existsSync(socketPath)) {
    const isSocketInUse = await new Promise<boolean>((resolve) => {
      const client = net.createConnection({ path: socketPath });
      client.on('connect', () => {
        client.destroy();
        resolve(true);
      });
      client.on('error', () => {
        resolve(false);
      });
    });

    if (isSocketInUse) {
      console.log('Daemon is already running (socket is active). Exiting.');
      process.exit(0);
    }

    try {
      fs.unlinkSync(socketPath);
    } catch {
      // Ignore
    }
  }

  let isReady = false;
  let readyPromiseResolve: () => void;
  const readyPromise = new Promise<void>((resolve) => {
    readyPromiseResolve = resolve;
  });

  const handler = createHTTPHandler({
    router: appRouter,
    createContext: ({ req, res }) => ({ req, res, isApiServer: false }),
  });

  const server = http.createServer(async (req, res) => {
    if (!isReady) {
      await readyPromise;
    }
    // Only accept POST requests on /trpc/ path if needed, but since we are running over Unix socket, we map directly
    handler(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.log('Daemon is already running (socket bind failed). Exiting.');
        process.exit(0);
      }
      reject(err);
    });
    server.listen(socketPath, () => {
      console.log(`Daemon initialized and listening on ${socketPath}`);
      resolve();
    });
  });

  await runHooks('up');

  isReady = true;
  readyPromiseResolve!();

  // Initialize cron jobs
  cronManager.init().catch((err) => {
    console.error('Failed to initialize cron manager:', err);
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

  let isShuttingDown = false;
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log('Daemon shutting down...');

    await runHooks('down');

    server.close();
    if (apiServer) apiServer.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

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
  initDaemon().catch((err) => {
    console.error('Daemon initialization failed:', err);
    process.exit(1);
  });
}
