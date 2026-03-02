import { describe, it, expect } from 'vitest';
import { generateToken, validateToken, type TokenPayload } from './auth.js';

describe('Auth token generation and validation', () => {
  it('should generate a valid token and validate it successfully', () => {
    const payload: TokenPayload = {
      chatId: 'chat-123',
      agentId: 'agent-456',
      sessionId: 'session-789',
      timestamp: Date.now(),
    };

    const token = generateToken(payload);
    expect(typeof token).toBe('string');
    expect(token).toContain('.');

    const validated = validateToken(token);
    expect(validated).not.toBeNull();
    expect(validated?.chatId).toBe(payload.chatId);
    expect(validated?.agentId).toBe(payload.agentId);
    expect(validated?.sessionId).toBe(payload.sessionId);
    expect(validated?.timestamp).toBe(payload.timestamp);
  });

  it('should return null for invalid tokens', () => {
    expect(validateToken('invalid-token')).toBeNull();
    expect(validateToken('part1.part2')).toBeNull();
    expect(validateToken('')).toBeNull();
  });

  it('should return null if token signature is modified', () => {
    const payload: TokenPayload = {
      chatId: 'chat-123',
      agentId: 'agent-456',
      sessionId: 'session-789',
      timestamp: Date.now(),
    };

    const token = generateToken(payload);
    const parts = token.split('.');
    if (!parts[1]) throw new Error('Invalid token');

    // Modify the signature slightly
    const modifiedSignature =
      parts[1].substring(0, parts[1].length - 1) + (parts[1].endsWith('a') ? 'b' : 'a');
    const tamperedToken = `${parts[0]}.${modifiedSignature}`;

    expect(validateToken(tamperedToken)).toBeNull();
  });
});
