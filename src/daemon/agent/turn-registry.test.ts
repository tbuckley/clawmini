import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  registerTurn,
  incrementSubagent,
  decrementSubagent,
  markParentExited,
  _resetTurnRegistryForTests,
  _getTurnStateForTests,
} from './turn-registry.js';
import { daemonEvents, DAEMON_EVENT_TURN_ENDED, type TurnEndedEvent } from '../events.js';

describe('turn-registry', () => {
  let ended: TurnEndedEvent[];
  const capture = (e: TurnEndedEvent) => {
    ended.push(e);
  };

  beforeEach(() => {
    ended = [];
    daemonEvents.on(DAEMON_EVENT_TURN_ENDED, capture);
    _resetTurnRegistryForTests();
  });

  afterEach(() => {
    daemonEvents.off(DAEMON_EVENT_TURN_ENDED, capture);
    _resetTurnRegistryForTests();
  });

  it('fires turnEnded immediately when parent exits with no outstanding subagents', () => {
    registerTurn('chat-1', 'turn-a');
    markParentExited('turn-a', 'ok');
    expect(ended).toEqual([{ chatId: 'chat-1', turnId: 'turn-a', outcome: 'ok' }]);
    expect(_getTurnStateForTests('turn-a')).toBeUndefined();
  });

  it('defers turnEnded until outstanding subagents drain', () => {
    registerTurn('chat-1', 'turn-a');
    incrementSubagent('turn-a');
    incrementSubagent('turn-a');
    markParentExited('turn-a', 'ok');
    expect(ended).toEqual([]);
    decrementSubagent('turn-a');
    expect(ended).toEqual([]);
    decrementSubagent('turn-a');
    expect(ended).toEqual([{ chatId: 'chat-1', turnId: 'turn-a', outcome: 'ok' }]);
  });

  it('preserves outcome=error when parent exited with an error', () => {
    registerTurn('chat-1', 'turn-a');
    incrementSubagent('turn-a');
    markParentExited('turn-a', 'error');
    decrementSubagent('turn-a');
    expect(ended).toEqual([{ chatId: 'chat-1', turnId: 'turn-a', outcome: 'error' }]);
  });

  it('ignores decrements below zero and extra markParentExited calls', () => {
    registerTurn('chat-1', 'turn-a');
    decrementSubagent('turn-a'); // no-op
    markParentExited('turn-a', 'ok');
    markParentExited('turn-a', 'error'); // ignored
    expect(ended).toEqual([{ chatId: 'chat-1', turnId: 'turn-a', outcome: 'ok' }]);
  });

  it('force-fires turnEnded with outcome=error when the timeout elapses', () => {
    vi.useFakeTimers();
    try {
      registerTurn('chat-1', 'turn-a', 100);
      incrementSubagent('turn-a');
      markParentExited('turn-a', 'ok');
      expect(ended).toEqual([]);
      vi.advanceTimersByTime(150);
      expect(ended).toEqual([{ chatId: 'chat-1', turnId: 'turn-a', outcome: 'error' }]);
      // A later decrement after force-fire is a no-op (turn already removed).
      decrementSubagent('turn-a');
      expect(ended).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is a no-op for unknown turnIds and undefined turnIds', () => {
    incrementSubagent(undefined);
    decrementSubagent(undefined);
    incrementSubagent('never-registered');
    decrementSubagent('never-registered');
    markParentExited('never-registered', 'ok');
    expect(ended).toEqual([]);
  });
});
