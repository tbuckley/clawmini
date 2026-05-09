import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTurnLogBuffer, type TurnLogBufferDeps } from './turn-log-buffer.js';
import type { ToolMessage } from '../chats.js';

type Anchor = 'A';

const FIXED_TS = '2026-04-20T12:04:02.000Z';

function makeTool(idx: number, payloadOverride?: unknown): ToolMessage {
  return {
    id: `m-${idx}`,
    role: 'tool',
    content: '',
    timestamp: FIXED_TS,
    sessionId: 's',
    messageId: `mid-${idx}`,
    name: 'Read',
    payload: payloadOverride ?? { file_path: `src/file-${idx}.ts` },
  };
}

interface DepsHandle {
  deps: TurnLogBufferDeps<Anchor>;
  posts: { text: string }[];
  edits: { id: string; text: string }[];
  postFn: ReturnType<typeof vi.fn>;
  editFn: ReturnType<typeof vi.fn>;
}

function makeDeps(over: Partial<TurnLogBufferDeps<Anchor>> = {}): DepsHandle {
  const posts: { text: string }[] = [];
  const edits: { id: string; text: string }[] = [];
  let nextId = 1;
  const postFn = vi.fn(async (_anchor: Anchor, text: string): Promise<string> => {
    posts.push({ text });
    return `log-${nextId++}`;
  });
  const editFn = vi.fn(async (_anchor: Anchor, id: string, text: string): Promise<void> => {
    edits.push({ id, text });
  });
  const deps: TurnLogBufferDeps<Anchor> = {
    postThreaded: postFn,
    editThreaded: editFn,
    isMissingMessageError: (e) => (e as { code?: number })?.code === 404,
    threadsEnabled: true,
    options: {
      maxToolPreview: 100,
      maxLogMessageChars: 200,
      editDebounceMs: 10,
      maxAttempts: 3,
      retryBaseDelayMs: 1,
    },
    ...over,
  };
  return { deps, posts, edits, postFn, editFn };
}

describe('createTurnLogBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('posts an initial "Started processing…" entry when started with an anchor', async () => {
    const { deps, postFn } = makeDeps();
    const buf = createTurnLogBuffer(deps);
    buf.start({ turnId: 't1', threadsDisabled: false, anchorThread: 'A' });
    await vi.runAllTimersAsync();
    expect(postFn).toHaveBeenCalledTimes(1);
    expect(postFn.mock.calls[0]![1]).toContain('Started processing');
  });

  it('debounces appends into a single edit', async () => {
    const { deps, postFn, editFn } = makeDeps();
    const buf = createTurnLogBuffer(deps);
    buf.start({ turnId: 't1', threadsDisabled: false, anchorThread: 'A' });
    await vi.runAllTimersAsync();
    buf.append('t1', makeTool(1));
    buf.append('t1', makeTool(2));
    buf.append('t1', makeTool(3));
    await vi.advanceTimersByTimeAsync(50);
    await vi.runAllTimersAsync();
    expect(postFn).toHaveBeenCalledTimes(1);
    // All three appends should land in a single edit (one debounced flush).
    expect(editFn).toHaveBeenCalledTimes(1);
    expect(editFn.mock.calls[0]![2]).toContain('file-3.ts');
  });

  it('does NOT abort the turn when the initial post fails — retries on next flush', async () => {
    const { deps } = makeDeps();
    // Fail the first 3 attempts (= one full flush at maxAttempts=3), then succeed.
    let calls = 0;
    deps.postThreaded = vi.fn(async () => {
      calls += 1;
      if (calls <= 3) throw Object.assign(new Error('rate limited'), { code: 429 });
      return 'log-1';
    });
    const buf = createTurnLogBuffer(deps);
    buf.start({ turnId: 't1', threadsDisabled: false, anchorThread: 'A' });
    await vi.runAllTimersAsync();
    // First flush exhausted retries → buffer kept entries. Append more → next
    // flush should retry and now succeed.
    buf.append('t1', makeTool(1));
    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();
    expect(deps.postThreaded).toHaveBeenCalledTimes(4);
    expect(buf.has('t1')).toBe(true);
  });

  it('retries on transient post failure and eventually posts within one flush', async () => {
    const { deps } = makeDeps();
    let calls = 0;
    deps.postThreaded = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error('rate limited'), { code: 429 });
      return 'log-ok';
    });
    const buf = createTurnLogBuffer(deps);
    buf.start({ turnId: 't1', threadsDisabled: false, anchorThread: 'A' });
    await vi.runAllTimersAsync();
    expect(deps.postThreaded).toHaveBeenCalledTimes(3);
  });

  it('preserves entries appended during an in-flight rollover send', async () => {
    const { deps, postFn, editFn } = makeDeps();
    // Big single entry (forces rollover after a few appends).
    const buf = createTurnLogBuffer(deps);
    buf.start({ turnId: 't1', threadsDisabled: false, anchorThread: 'A' });
    await vi.runAllTimersAsync();

    // Slow-edit shim: the FIRST edit takes a tick to resolve. While it's in
    // flight we append another entry; the buffer must not drop it on rollover.
    let resolveSlow: (() => void) | null = null;
    const slowPromise = new Promise<void>((r) => {
      resolveSlow = r;
    });
    const realEdit = deps.editThreaded;
    let editCount = 0;
    deps.editThreaded = vi.fn(async (anchor, id, text) => {
      editCount += 1;
      if (editCount === 1) await slowPromise;
      await realEdit(anchor, id, text);
    });

    // Push enough big entries to trigger rollover.
    for (let i = 0; i < 8; i++) buf.append('t1', makeTool(i, { file_path: 'x'.repeat(80) }));
    // Kick the flush.
    await vi.advanceTimersByTimeAsync(50);
    // Append a *new* entry while the slow edit is mid-flight.
    buf.append('t1', makeTool(99, { file_path: 'late-arriving.ts' }));
    // Let the slow edit complete and the rollover loop continue.
    resolveSlow!();
    await vi.runAllTimersAsync();
    await vi.advanceTimersByTimeAsync(50);
    await vi.runAllTimersAsync();

    const allText = [
      ...postFn.mock.calls.map((c) => c[1] as string),
      ...editFn.mock.calls.map((c) => c[2] as string),
    ].join('\n');
    expect(allText).toContain('late-arriving.ts');
  });

  it('reposts a fresh log message when the existing one returns missing-message', async () => {
    const { deps, postFn } = makeDeps();
    let editCalls = 0;
    deps.editThreaded = vi.fn(async () => {
      editCalls += 1;
      if (editCalls === 1) throw Object.assign(new Error('not found'), { code: 404 });
    });
    const buf = createTurnLogBuffer(deps);
    buf.start({ turnId: 't1', threadsDisabled: false, anchorThread: 'A' });
    await vi.runAllTimersAsync();
    buf.append('t1', makeTool(1));
    await vi.advanceTimersByTimeAsync(50);
    await vi.runAllTimersAsync();
    // Initial start post + one repost after the missing-message edit.
    expect(postFn).toHaveBeenCalledTimes(2);
  });

  it('does not flush when the anchor is unknown; flushes once assignAnchor is called', async () => {
    const { deps, postFn } = makeDeps();
    const buf = createTurnLogBuffer(deps);
    buf.start({ turnId: 't1', threadsDisabled: false, anchorThread: undefined });
    buf.append('t1', makeTool(1));
    buf.append('t1', makeTool(2));
    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();
    expect(postFn).not.toHaveBeenCalled();
    buf.assignAnchor('t1', 'A');
    await vi.runAllTimersAsync();
    expect(postFn).toHaveBeenCalledTimes(1);
    expect(postFn.mock.calls[0]![1]).toContain('file-1');
    expect(postFn.mock.calls[0]![1]).toContain('file-2');
  });

  it('skips the start entry when threads are globally disabled', async () => {
    const { deps, postFn } = makeDeps({ threadsEnabled: false });
    const buf = createTurnLogBuffer(deps);
    buf.start({ turnId: 't1', threadsDisabled: false, anchorThread: 'A' });
    await vi.runAllTimersAsync();
    buf.append('t1', makeTool(1));
    await vi.runAllTimersAsync();
    expect(postFn).not.toHaveBeenCalled();
  });
});
