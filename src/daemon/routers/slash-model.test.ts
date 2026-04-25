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

  it('rejects reserved shorthand names', async () => {
    for (const name of ['help', 'add', 'remove', 'rm']) {
      const result = await slashModel({
        ...baseState,
        message: `/model add ${name} some-model`,
      });
      expect(result.reply).toBe(`Invalid shorthand: '${name}' is reserved.`);
    }
    expect(writeAgentSettings).not.toHaveBeenCalled();
  });

  it('shows help on /model help', async () => {
    const result = await slashModel({ ...baseState, message: '/model help' });
    expect(result.action).toBe('stop');
    expect(result.reply).toContain('/model add <shorthand> <full-name>');
    expect(result.reply).toContain('/model remove <shorthand>');
    expect(writeAgentSettings).not.toHaveBeenCalled();
    expect(getAgent).not.toHaveBeenCalled();
  });

  it('rejects unknown -flags with help', async () => {
    const result = await slashModel({ ...baseState, message: '/model -h' });
    expect(result.reply).toContain('Unknown option: -h');
    expect(result.reply).toContain('Usage:');
    expect(writeAgentSettings).not.toHaveBeenCalled();
  });

  it('rejects unknown subcommands with extra args', async () => {
    const result = await slashModel({ ...baseState, message: '/model rmove flash' });
    expect(result.reply).toContain('Unknown subcommand: rmove');
    expect(writeAgentSettings).not.toHaveBeenCalled();
  });

  it('removes a shorthand from the overlay', async () => {
    vi.mocked(getAgentOverlay).mockResolvedValue({
      env: { MODEL: 'gemini-3-pro' },
      modelShorthands: { flash: 'gemini-3-flash-preview', lite: 'gemini-3.1-flash-lite' },
    });
    vi.mocked(getAgent).mockResolvedValue({
      modelShorthands: { lite: 'gemini-3.1-flash-lite' },
    });

    const result = await slashModel({ ...baseState, message: '/model remove flash' });

    expect(writeAgentSettings).toHaveBeenCalledWith(
      'jeeves',
      {
        env: { MODEL: 'gemini-3-pro' },
        modelShorthands: { lite: 'gemini-3.1-flash-lite' },
      },
      '/mock/workspace'
    );
    expect(result.reply).toBe('Removed shorthand: flash.');
  });

  it('drops the modelShorthands key when removing the last entry', async () => {
    vi.mocked(getAgentOverlay).mockResolvedValue({
      env: { MODEL: 'gemini-3-pro' },
      modelShorthands: { flash: 'gemini-3-flash-preview' },
    });
    vi.mocked(getAgent).mockResolvedValue({ env: { MODEL: 'gemini-3-pro' } });

    await slashModel({ ...baseState, message: '/model rm flash' });

    expect(writeAgentSettings).toHaveBeenCalledWith(
      'jeeves',
      { env: { MODEL: 'gemini-3-pro' } },
      '/mock/workspace'
    );
  });

  it('notes when a removed shorthand still resolves from the template', async () => {
    vi.mocked(getAgentOverlay).mockResolvedValue({
      modelShorthands: { flash: 'overridden-flash' },
    });
    vi.mocked(getAgent).mockResolvedValue({
      modelShorthands: { flash: 'template-flash' },
    });

    const result = await slashModel({ ...baseState, message: '/model rm flash' });

    expect(result.reply).toBe(
      "Removed shorthand: flash (still resolves to 'template-flash' from template)."
    );
  });

  it('reports template-only shorthands as unremovable', async () => {
    vi.mocked(getAgentOverlay).mockResolvedValue({});
    vi.mocked(getAgent).mockResolvedValue({
      modelShorthands: { flash: 'template-flash' },
    });

    const result = await slashModel({ ...baseState, message: '/model remove flash' });

    expect(result.reply).toContain("'flash' is defined in the template");
    expect(writeAgentSettings).not.toHaveBeenCalled();
  });

  it('reports unknown shorthands on /model remove', async () => {
    vi.mocked(getAgentOverlay).mockResolvedValue({
      modelShorthands: { flash: 'x' },
    });
    vi.mocked(getAgent).mockResolvedValue({ modelShorthands: { flash: 'x' } });

    const result = await slashModel({ ...baseState, message: '/model rm bogus' });

    expect(result.reply).toBe("Shorthand 'bogus' not found.");
    expect(writeAgentSettings).not.toHaveBeenCalled();
  });

  it('reports usage on /model remove with no argument', async () => {
    const result = await slashModel({ ...baseState, message: '/model remove' });
    expect(result.reply).toBe('Usage: /model remove <shorthand>');
    expect(writeAgentSettings).not.toHaveBeenCalled();
  });

  it('warns when an unknown shorthand-shaped name is set', async () => {
    vi.mocked(getAgent).mockResolvedValue({ modelShorthands: { flash: 'x' } });
    vi.mocked(getAgentOverlay).mockResolvedValue(null);

    const result = await slashModel({ ...baseState, message: '/model claude' });

    expect(writeAgentSettings).toHaveBeenCalledWith(
      'jeeves',
      { env: { MODEL: 'claude' } },
      '/mock/workspace'
    );
    expect(result.reply).toContain('Set MODEL to claude.');
    expect(result.reply).toContain('No shorthand matched');
    expect(result.reply).toContain('/model add claude <full-name>');
  });

  it('does not warn when the literal name has separators', async () => {
    vi.mocked(getAgent).mockResolvedValue({ modelShorthands: {} });
    vi.mocked(getAgentOverlay).mockResolvedValue(null);

    const result = await slashModel({ ...baseState, message: '/model claude-opus-4-7' });

    expect(result.reply).toBe('Set MODEL to claude-opus-4-7.');
  });

  it('does not match /models or other prefixes', async () => {
    const state = { ...baseState, message: '/models gpt-5' };
    const result = await slashModel(state);
    expect(result).toEqual(state);
  });
});
