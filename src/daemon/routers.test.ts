import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeRouterPipeline } from './routers.js';
import type { RouterState } from './routers/types.js';

vi.mock('./routers/slash-new.js', () => ({
  slashNew: vi.fn((state: RouterState) => ({ ...state, message: 'slash-new-called' })),
}));

vi.mock('./routers/slash-command.js', () => ({
  slashCommand: vi.fn(async (state: RouterState) => ({
    ...state,
    message: 'slash-command-called',
  })),
}));

vi.mock('./routers/slash-stop.js', () => ({
  slashStop: vi.fn((state: RouterState) => ({ ...state, action: 'stop' })),
}));

vi.mock('./routers/slash-interrupt.js', () => ({
  slashInterrupt: vi.fn((state: RouterState) => ({ ...state, action: 'interrupt' })),
}));

vi.mock('./routers/slash-policies.js', () => ({
  slashPolicies: vi.fn(async (state: RouterState) => state),
}));

describe('Router Pipeline Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should pass state unchanged when no routers are provided', async () => {
    const initialState: RouterState = {
      message: 'hello',
      chatId: 'chat-1',
    };
    const finalState = await executeRouterPipeline(initialState, []);
    expect(finalState).toEqual(initialState);
  });

  it('should call built-in @clawmini/slash-new router', async () => {
    const initialState: RouterState = {
      message: 'hello',
      chatId: 'chat-1',
    };
    const finalState = await executeRouterPipeline(initialState, ['@clawmini/slash-new']);
    expect(finalState.message).toBe('slash-new-called');
    expect(finalState.chatId).toBe('chat-1');
  });

  it('should call built-in @clawmini/slash-command router', async () => {
    const initialState: RouterState = {
      message: 'hello',
      chatId: 'chat-1',
    };
    const finalState = await executeRouterPipeline(initialState, ['@clawmini/slash-command']);
    expect(finalState.message).toBe('slash-command-called');
  });

  it('should call built-in @clawmini/slash-stop router', async () => {
    const initialState: RouterState = {
      message: 'hello',
      chatId: 'chat-1',
    };
    const finalState = await executeRouterPipeline(initialState, ['@clawmini/slash-stop']);
    expect(finalState.action).toBe('stop');
  });

  it('should call built-in @clawmini/slash-interrupt router', async () => {
    const initialState: RouterState = {
      message: 'hello',
      chatId: 'chat-1',
    };
    const finalState = await executeRouterPipeline(initialState, ['@clawmini/slash-interrupt']);
    expect(finalState.action).toBe('interrupt');
  });

  it('should execute custom shell command router and merge state correctly', async () => {
    const initialState: RouterState = {
      message: 'hello',
      chatId: 'chat-1',
      env: { FOO: 'bar' },
    };

    // Command that parses stdin and outputs a modified JSON object
    const command = `node -e "
      let input = ''; 
      process.stdin.on('data', d => input += d); 
      process.stdin.on('end', () => { 
        const data = JSON.parse(input); 
        console.log(JSON.stringify({ 
          message: data.message + ' world', 
          agent: 'new-agent', 
          session: 'new-session', 
          env: { BAZ: 'qux' }, 
          reply: 'Custom router reply' 
        })); 
      }); 
    "`;

    const finalState = await executeRouterPipeline(initialState, [command]);

    expect(finalState.message).toBe('hello world');
    expect(finalState.agentId).toBe('new-agent');
    expect(finalState.sessionId).toBe('new-session');
    expect(finalState.env).toEqual({ FOO: 'bar', BAZ: 'qux' });
    expect(finalState.reply).toBe('Custom router reply');
    expect(finalState.chatId).toBe('chat-1'); // Unchanged
  });

  it('should handle silent failure of custom shell command router', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const initialState: RouterState = {
      message: 'hello',
      chatId: 'chat-1',
    };

    // Command that intentionally fails with a non-zero exit code
    const command = `node -e "process.exit(1);"`;

    const finalState = await executeRouterPipeline(initialState, [command]);

    // State should remain unchanged
    expect(finalState).toEqual(initialState);

    // The error should have been logged
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
