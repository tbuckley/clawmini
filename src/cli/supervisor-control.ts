import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { getClawminiDir } from '../shared/workspace.js';

export type ControlAction = 'restart' | 'shutdown' | 'upgrade';

export interface ControlRequest {
  action: ControlAction;
}

export interface ControlResponse {
  ok: boolean;
  error?: string;
}

export function getControlSocketPath(startDir = process.cwd()): string {
  return path.join(getClawminiDir(startDir), 'supervisor.sock');
}

export type ControlHandler = () => Promise<ControlResponse> | ControlResponse;

export function startControlServer(
  handlers: Record<ControlAction, ControlHandler>,
  socketPath = getControlSocketPath()
): net.Server {
  if (fs.existsSync(socketPath)) {
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // best-effort
    }
  }

  const server = net.createServer((socket) => {
    let buf = '';
    let handled = false;

    const respond = (res: ControlResponse): void => {
      if (handled) return;
      handled = true;
      socket.end(JSON.stringify(res) + '\n');
    };

    socket.on('data', (chunk) => {
      if (handled) return;
      buf += chunk.toString();
      const idx = buf.indexOf('\n');
      if (idx === -1) return;
      const line = buf.slice(0, idx);
      let req: ControlRequest;
      try {
        req = JSON.parse(line) as ControlRequest;
      } catch {
        respond({ ok: false, error: 'invalid request' });
        return;
      }
      const handler = handlers[req.action];
      if (!handler) {
        respond({ ok: false, error: `unknown action: ${req.action}` });
        return;
      }
      Promise.resolve()
        .then(() => handler())
        .then(
          (res) => respond(res),
          (err: unknown) =>
            respond({ ok: false, error: err instanceof Error ? err.message : String(err) })
        );
    });

    socket.on('error', () => {
      // Ignore; the client likely went away mid-write.
    });
  });

  server.listen(socketPath);
  return server;
}

export function sendControlRequest(
  req: ControlRequest,
  socketPath = getControlSocketPath(),
  timeoutMs = 5000
): Promise<ControlResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath });
    let buf = '';
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // best-effort
      }
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error(`Control request timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    socket.on('connect', () => {
      socket.write(JSON.stringify(req) + '\n');
    });
    socket.on('data', (chunk) => {
      buf += chunk.toString();
      const idx = buf.indexOf('\n');
      if (idx !== -1) {
        const line = buf.slice(0, idx);
        clearTimeout(timer);
        try {
          const res = JSON.parse(line) as ControlResponse;
          finish(() => resolve(res));
        } catch (err) {
          finish(() => reject(err instanceof Error ? err : new Error(String(err))));
        }
      }
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      finish(() => reject(err));
    });
    socket.on('end', () => {
      // If the server closed before sending us a full line, surface it.
      if (!settled) {
        clearTimeout(timer);
        finish(() => reject(new Error('Control server closed connection without responding')));
      }
    });
  });
}
