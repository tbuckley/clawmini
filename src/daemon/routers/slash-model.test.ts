import { describe, it, expect, vi, beforeEach } from 'vitest';
import { slashModel } from './slash-model.js';
import {
  getAgent,
  getAgentOverlay,
  writeAgentSettings,
  getWorkspaceRoot,
} from '../../shared/workspace.js';

vi.mock('../../shared/workspace.js');

const baseState = {
  message: '',
  messageId: 'mock-msg-id',
  chatId: 'chat-1',
  agentId: 'jeeves',
};

describe('slashModel router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWorkspaceRoot).mockReturnValue('/mock/workspace');
  });

  it('passes through unrelated messages', async () => {
    const state = { ...baseState, message: 'hello world' };
    const result = await slashModel(state);
    expect(result).toEqual(state);
    expect(writeAgentSettings).not.toHaveBeenCalled();
  });

  it('lists the current model and shorthands on bare /model', async () => {
    vi.mocked(getAgent).mockResolvedValue({
      env: { MODEL: 'gemini-3-pro' },
      modelShorthands: { flash: 'gemini-3-flash-preview', pro: 'gemini-3-pro' },
    });

    const result = await slashModel({ ...baseState, message: '/model' });

    expect(result.action).toBe('stop');
    expect(result.message).toBe('');
    expect(result.reply).toContain('Current model: gemini-3-pro');
    expect(result.reply).toContain('- flash -> gemini-3-flash-preview');
    expect(result.reply).toContain('- pro -> gemini-3-pro');
  });

  it('reports (unset) when no MODEL is configured', async () => {
    vi.mocked(getAgent).mockResolvedValue({});
    const result = await slashModel({ ...baseState, message: '/model' });
    expect(result.reply).toContain('Current model: (unset)');
    expect(result.reply).toContain('No shorthands defined.');
  });

  it('sets env.MODEL using a shorthand', async () => {
    vi.mocked(getAgent).mockResolvedValue({
      modelShorthands: { flash: 'gemini-3-flash-preview' },
    });
    vi.mocked(getAgentOverlay).mockResolvedValue({
      env: { OTHER: 'keep' },
      modelShorthands: { flash: 'gemini-3-flash-preview' },
    });

    const result = await slashModel({ ...baseState, message: '/model flash' });

    expect(writeAgentSettings).toHaveBeenCalledWith(
      'jeeves',
      {
        env: { OTHER: 'keep', MODEL: 'gemini-3-flash-preview' },
        modelShorthands: { flash: 'gemini-3-flash-preview' },
      },
      '/mock/workspace'
    );
    expect(result.action).toBe('stop');
    expect(result.reply).toContain('Set MODEL to gemini-3-flash-preview');
    expect(result.reply).toContain("shorthand 'flash'");
  });

  it('sets env.MODEL to a full string when no shorthand matches', async () => {
    vi.mocked(getAgent).mockResolvedValue({ modelShorthands: {} });
    vi.mocked(getAgentOverlay).mockResolvedValue(null);

    const result = await slashModel({
      ...baseState,
      message: '/model gemini-3.1-flash-lite',
    });

    expect(writeAgentSettings).toHaveBeenCalledWith(
      'jeeves',
      { env: { MODEL: 'gemini-3.1-flash-lite' } },
      '/mock/workspace'
    );
    expect(result.reply).toBe('Set MODEL to gemini-3.1-flash-lite.');
  });

  it('adds a shorthand on /model add', async () => {
    vi.mocked(getAgentOverlay).mockResolvedValue({
      env: { MODEL: 'gemini-3-pro' },
      modelShorthands: { flash: 'gemini-3-flash-preview' },
    });

    const result = await slashModel({
      ...baseState,
      message: '/model add lite gemini-3.1-flash-lite',
    });

    expect(writeAgentSettings).toHaveBeenCalledWith(
      'jeeves',
      {
        env: { MODEL: 'gemini-3-pro' },
        modelShorthands: {
          flash: 'gemini-3-flash-preview',
          lite: 'gemini-3.1-flash-lite',
        },
      },
      '/mock/workspace'
    );
    expect(result.reply).toBe('Added shorthand: lite -> gemini-3.1-flash-lite');
    expect(result.action).toBe('stop');
  });

  it('replaces an existing shorthand on /model add', async () => {
    vi.mocked(getAgentOverlay).mockResolvedValue({
      modelShorthands: { flash: 'old-flash' },
    });

    await slashModel({
      ...baseState,
      message: '/model add flash gemini-3-flash-preview',
    });

    expect(writeAgentSettings).toHaveBeenCalledWith(
      'jeeves',
      { modelShorthands: { flash: 'gemini-3-flash-preview' } },
      '/mock/workspace'
    );
  });

  it('reports a usage error on malformed /model add', async () => {
    const result = await slashModel({ ...baseState, message: '/model add flash' });
    expect(result.reply).toBe('Usage: /model add <shorthand> <full-name>');
    expect(writeAgentSettings).not.toHaveBeenCalled();
  });

  it('does not match /models or other prefixes', async () => {
    const state = { ...baseState, message: '/models gpt-5' };
    const result = await slashModel(state);
    expect(result).toEqual(state);
  });
});
