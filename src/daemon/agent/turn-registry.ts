import { emitTurnEnded } from '../events.js';

interface TurnState {
  chatId: string;
  outstanding: number;
  parentExited: boolean;
  outcome: 'ok' | 'error';
  timeoutHandle: NodeJS.Timeout;
}

const turns = new Map<string, TurnState>();

/**
 * Watchdog for turns whose subagent count never drains. Pathological cases
 * (crashed subagent, bug leaving the counter > 0) would otherwise pin the
 * turn's activity log open indefinitely. Default is a guess — instrument
 * before tuning.
 */
export const DEFAULT_TURN_MAX_DURATION_MS = 30 * 60 * 1000;

export function registerTurn(
  chatId: string,
  turnId: string,
  maxDurationMs: number = DEFAULT_TURN_MAX_DURATION_MS
): void {
  if (turns.has(turnId)) return;
  const state: TurnState = {
    chatId,
    outstanding: 0,
    parentExited: false,
    outcome: 'ok',
    timeoutHandle: setTimeout(() => {
      const s = turns.get(turnId);
      if (!s) return;
      console.warn(
        `Turn ${turnId} force-ended after ${maxDurationMs}ms (outstanding=${s.outstanding}).`
      );
      turns.delete(turnId);
      emitTurnEnded({ chatId: s.chatId, turnId, outcome: 'error' });
    }, maxDurationMs),
  };
  state.timeoutHandle.unref();
  turns.set(turnId, state);
}

export function incrementSubagent(turnId: string | undefined): void {
  if (!turnId) return;
  const state = turns.get(turnId);
  if (!state) return;
  state.outstanding++;
}

export function decrementSubagent(turnId: string | undefined): void {
  if (!turnId) return;
  const state = turns.get(turnId);
  if (!state) return;
  state.outstanding = Math.max(0, state.outstanding - 1);
  maybeFinalize(turnId, state);
}

/**
 * Called once, when the parent agent's initial `handleMessage` promise
 * settles. Records the outcome; the turn actually ends (emits `turnEnded`)
 * only once the outstanding subagent count also reaches zero.
 */
export function markParentExited(turnId: string, outcome: 'ok' | 'error'): void {
  const state = turns.get(turnId);
  if (!state) return;
  if (state.parentExited) return;
  state.parentExited = true;
  state.outcome = outcome;
  maybeFinalize(turnId, state);
}

function maybeFinalize(turnId: string, state: TurnState): void {
  if (!state.parentExited) return;
  if (state.outstanding > 0) return;
  clearTimeout(state.timeoutHandle);
  turns.delete(turnId);
  emitTurnEnded({ chatId: state.chatId, turnId, outcome: state.outcome });
}

/** Test hook: drop all state without emitting events. */
export function _resetTurnRegistryForTests(): void {
  for (const state of turns.values()) {
    clearTimeout(state.timeoutHandle);
  }
  turns.clear();
}

/** Test hook: inspect registry state. */
export function _getTurnStateForTests(turnId: string): Readonly<TurnState> | undefined {
  return turns.get(turnId);
}
