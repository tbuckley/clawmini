import { describe, it, expect } from 'vitest';
import { formatAggregateBody } from './delegation-notify.js';
import type { Delegation } from '../shared/delegations.js';

function completed(id: string): Delegation {
  return {
    id,
    kind: 'subagent',
    state: 'completed',
    delivery: 'notify',
    chatId: 'chat-1',
    agentId: 'agent-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    resolvedAt: '2026-01-01T00:00:01.000Z',
    targetAgentId: 'helper',
    sessionId: 'sess-1',
    prompt: 'do',
  };
}

describe('formatAggregateBody', () => {
  it('reports "All N" and no pending line when every member resolved', () => {
    const body = formatAggregateBody([completed('aaa'), completed('bbb')], 'all');
    expect(body).toContain("All 2 delegations resolved (mode: 'all').");
    expect(body).toContain('completed (2): aaa, bbb');
    expect(body).not.toContain('still pending');
  });

  it('reports the resolved fraction and lists pending ids for a partial any-mode fire', () => {
    const body = formatAggregateBody([completed('aaa')], 'any', ['bbb', 'ccc']);
    expect(body).toContain("1 of 3 delegations resolved (mode: 'any').");
    expect(body).not.toContain('All 1');
    expect(body).toContain('still pending (2): bbb, ccc');
  });
});
