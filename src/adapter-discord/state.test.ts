import { describe, it, expect, vi, beforeEach } from 'vitest';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { readDiscordState, writeDiscordState, getDiscordStatePath } from './state.js';

vi.mock('node:fs/promises');
vi.mock('../shared/workspace.js', () => ({
  getClawminiDir: vi.fn(() => '/mock/clawmini'),
  getWorkspaceRoot: vi.fn(() => '/mock/workspace'),
}));

describe('Discord State Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return default state if file does not exist', async () => {
    vi.mocked(fsPromises.readFile).mockRejectedValue(new Error('File not found'));

    const state = await readDiscordState();
    expect(state).toEqual({ lastSyncedMessageId: undefined });
  });

  it('should read state from file', async () => {
    const mockState = { lastSyncedMessageId: '12345' };
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(mockState));

    const state = await readDiscordState();
    expect(state).toEqual(mockState);
  });

  it('should return default state if file contains invalid JSON', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue('invalid-json');

    const state = await readDiscordState();
    expect(state).toEqual({ lastSyncedMessageId: undefined });
  });

  it('should write state to file', async () => {
    const mockState = { lastSyncedMessageId: '67890' };
    const statePath = getDiscordStatePath();

    await writeDiscordState(mockState);

    expect(fsPromises.mkdir).toHaveBeenCalledWith(path.dirname(statePath), { recursive: true });
    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      statePath,
      JSON.stringify(mockState, null, 2),
      'utf-8'
    );
  });

  it('should handle errors when writing state', async () => {
    vi.mocked(fsPromises.writeFile).mockRejectedValue(new Error('Permission denied'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await writeDiscordState({ lastSyncedMessageId: '123' });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to write Discord state'),
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });
});
