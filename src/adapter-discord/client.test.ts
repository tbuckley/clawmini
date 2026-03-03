import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTRPCClient } from './client.js';
import fs from 'node:fs';
import * as workspace from '../shared/workspace.js';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createUnixSocketFetch } from '../shared/fetch.js';

vi.mock('node:fs');
vi.mock('../shared/workspace.js');
vi.mock('@trpc/client', () => ({
  createTRPCClient: vi.fn().mockReturnValue({
    ping: {
      query: vi.fn().mockResolvedValue({ status: 'ok' }),
    },
  }),
  httpLink: vi.fn(),
}));
vi.mock('../shared/fetch.js', () => ({
  createUnixSocketFetch: vi.fn(),
}));

describe('Discord Adapter TRPC Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw error if daemon socket does not exist', () => {
    vi.mocked(workspace.getSocketPath).mockReturnValue('/tmp/test.sock');
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(() => getTRPCClient()).toThrow('Daemon not running. Socket not found at /tmp/test.sock');
  });

  it('should create TRPC client if daemon socket exists', () => {
    vi.mocked(workspace.getSocketPath).mockReturnValue('/tmp/test.sock');
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const client = getTRPCClient();
    expect(client).toBeDefined();
    expect(createTRPCClient).toHaveBeenCalled();
    expect(httpLink).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost',
      })
    );
    expect(createUnixSocketFetch).toHaveBeenCalledWith('/tmp/test.sock');
  });

  it('should be able to call ping on the client', async () => {
    vi.mocked(workspace.getSocketPath).mockReturnValue('/tmp/test.sock');
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const client = getTRPCClient();
    const result = await client.ping.query();
    expect(result).toEqual({ status: 'ok' });
  });
});
