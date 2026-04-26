import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  startControlServer,
  sendControlRequest,
  type ControlAction,
  type ControlResponse,
} from './supervisor-control.js';

describe('supervisor control socket', () => {
  const cleanup: Array<() => void> = [];

  afterEach(() => {
    while (cleanup.length) {
      try {
        cleanup.pop()!();
      } catch {
        // best-effort
      }
    }
  });

  function makeSocketPath(): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clawmini-ctl-'));
    cleanup.push(() => fs.rmSync(tmp, { recursive: true, force: true }));
    return path.join(tmp, 'supervisor.sock');
  }

  it('round-trips a request to the matching handler', async () => {
    const sockPath = makeSocketPath();
    const calls: ControlAction[] = [];
    const handlers: Record<ControlAction, () => Promise<ControlResponse>> = {
      restart: async () => {
        calls.push('restart');
        return { ok: true };
      },
      shutdown: async () => {
        calls.push('shutdown');
        return { ok: true };
      },
      upgrade: async () => {
        calls.push('upgrade');
        return { ok: true };
      },
    };
    const server = startControlServer(handlers, sockPath);
    cleanup.push(() => server.close());

    const res = await sendControlRequest({ action: 'restart' }, sockPath);
    expect(res).toEqual({ ok: true });
    expect(calls).toEqual(['restart']);
  });

  it('returns the handler error when the handler rejects', async () => {
    const sockPath = makeSocketPath();
    const server = startControlServer(
      {
        restart: async () => {
          throw new Error('boom');
        },
        shutdown: async () => ({ ok: true }),
        upgrade: async () => ({ ok: true }),
      },
      sockPath
    );
    cleanup.push(() => server.close());

    const res = await sendControlRequest({ action: 'restart' }, sockPath);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('boom');
  });

  it('rejects unknown actions', async () => {
    const sockPath = makeSocketPath();
    const server = startControlServer(
      {
        restart: async () => ({ ok: true }),
        shutdown: async () => ({ ok: true }),
        upgrade: async () => ({ ok: true }),
      },
      sockPath
    );
    cleanup.push(() => server.close());

    const res = await sendControlRequest({ action: 'unknown' as ControlAction }, sockPath);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('unknown action');
  });

  it('overwrites a stale socket file at startup', async () => {
    const sockPath = makeSocketPath();
    fs.writeFileSync(sockPath, ''); // pretend a stale file is left over
    const server = startControlServer(
      {
        restart: async () => ({ ok: true }),
        shutdown: async () => ({ ok: true }),
        upgrade: async () => ({ ok: true }),
      },
      sockPath
    );
    cleanup.push(() => server.close());

    const res = await sendControlRequest({ action: 'shutdown' }, sockPath);
    expect(res).toEqual({ ok: true });
  });
});
