import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateGoogleChatState } from './state.js';
import fsPromises from 'node:fs/promises';

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

vi.mock('../shared/workspace.js', () => ({
  getClawminiDir: () => '/mock/clawmini',
}));

describe('Google Chat State Updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should process concurrent state updates sequentially to prevent data loss', async () => {
    // Create an initial state where lastSyncedMessageId is 'A' and activeSpaceName is 'Space1'
    const initialState = { lastSyncedMessageId: 'A', activeSpaceName: 'Space1' };

    // We mock readFile to always return the LAST state that was written by writeFile.
    // However, if the read/writes were not sequential (if they ran truly concurrently without a mutex),
    // they might both read the initial state and then overwrite each other.

    let currentMockStateJSON = JSON.stringify(initialState);

    vi.mocked(fsPromises.readFile).mockImplementation(async () => {
      // simulate delay to maximize chance of race condition if no mutex is used
      await new Promise((resolve) => setTimeout(resolve, 5));
      return currentMockStateJSON;
    });

    vi.mocked(fsPromises.writeFile).mockImplementation(async (_path, data) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      currentMockStateJSON = data as string;
    });

    // Fire two concurrent updates
    const update1 = updateGoogleChatState({ lastSyncedMessageIds: { default: 'B' } });
    const update2 = updateGoogleChatState({ activeSpaceName: 'Space2' });

    await Promise.all([update1, update2]);

    // Read the final state
    const finalState = JSON.parse(currentMockStateJSON);

    // If a race condition occurred, finalState would likely be either:
    // { lastSyncedMessageId: 'B', activeSpaceName: 'Space1' } OR
    // { lastSyncedMessageId: 'A', activeSpaceName: 'Space2' }
    // Because they are serialized, it should safely contain BOTH updates.
    expect(finalState).toEqual({
      lastSyncedMessageIds: { default: 'B' },
      activeSpaceName: 'Space2',
    });
  });

  it('should process callback updates sequentially and receive latest state', async () => {
    const initialState = { channelChatMap: { 'ext-1': 'chat-1' } };
    let currentMockStateJSON = JSON.stringify(initialState);

    vi.mocked(fsPromises.readFile).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return currentMockStateJSON;
    });

    vi.mocked(fsPromises.writeFile).mockImplementation(async (_path, data) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      currentMockStateJSON = data as string;
    });

    // Fire two concurrent callback updates
    const update1 = updateGoogleChatState((latest) => ({
      channelChatMap: { ...latest.channelChatMap, 'ext-2': 'chat-2' },
    }));
    const update2 = updateGoogleChatState((latest) => ({
      channelChatMap: { ...latest.channelChatMap, 'ext-3': 'chat-3' },
    }));

    await Promise.all([update1, update2]);

    const finalState = JSON.parse(currentMockStateJSON);

    expect(finalState).toEqual({
      channelChatMap: {
        'ext-1': 'chat-1',
        'ext-2': 'chat-2',
        'ext-3': 'chat-3',
      },
    });
  });
});
