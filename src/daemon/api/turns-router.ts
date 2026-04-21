import { z } from 'zod';
import { on } from 'node:events';
import {
  daemonEvents,
  DAEMON_EVENT_TURN_STARTED,
  DAEMON_EVENT_TURN_ENDED,
  type TurnStartedEvent,
  type TurnEndedEvent,
} from '../events.js';
import { getDefaultChatId } from '../chats.js';
import { apiProcedure } from './trpc.js';

export type TurnStreamEvent =
  | { type: 'started'; turnId: string; rootMessageId: string; externalRef?: string }
  | { type: 'ended'; turnId: string; outcome: 'ok' | 'error' };

export const waitForTurns = apiProcedure
  .input(
    z.object({
      chatId: z.string().optional(),
    })
  )
  .subscription(async function* ({ input, signal }) {
    const chatId = input.chatId ?? (await getDefaultChatId());

    const ac = new AbortController();
    const onParentAbort = () => ac.abort();
    signal?.addEventListener('abort', onParentAbort);

    const startedIter = on(daemonEvents, DAEMON_EVENT_TURN_STARTED, { signal: ac.signal });
    const endedIter = on(daemonEvents, DAEMON_EVENT_TURN_ENDED, { signal: ac.signal });

    const pump = async function* <T>(
      iter: AsyncIterableIterator<unknown>,
      mapper: (event: T) => TurnStreamEvent | null
    ): AsyncGenerator<TurnStreamEvent> {
      try {
        for await (const args of iter) {
          const [event] = args as [T];
          const mapped = mapper(event);
          if (mapped) yield mapped;
        }
      } catch (err) {
        if (!(err instanceof Error && err.name === 'AbortError')) throw err;
      }
    };

    const startedStream = pump<TurnStartedEvent>(
      startedIter as AsyncIterableIterator<unknown>,
      (event) =>
        event.chatId === chatId
          ? {
              type: 'started',
              turnId: event.turnId,
              rootMessageId: event.rootMessageId,
              ...(event.externalRef ? { externalRef: event.externalRef } : {}),
            }
          : null
    );
    const endedStream = pump<TurnEndedEvent>(
      endedIter as AsyncIterableIterator<unknown>,
      (event) =>
        event.chatId === chatId
          ? { type: 'ended', turnId: event.turnId, outcome: event.outcome }
          : null
    );

    const queue: TurnStreamEvent[] = [];
    let resolveNext: ((v: TurnStreamEvent | null) => void) | null = null;
    let done = false;

    const pushAll = async (stream: AsyncGenerator<TurnStreamEvent>) => {
      for await (const e of stream) {
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r(e);
        } else {
          queue.push(e);
        }
      }
    };

    const merged = Promise.all([pushAll(startedStream), pushAll(endedStream)]).then(() => {
      done = true;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r(null);
      }
    });

    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
          continue;
        }
        if (done) return;
        const next = await new Promise<TurnStreamEvent | null>((resolve) => {
          resolveNext = resolve;
        });
        if (next === null) return;
        yield next;
      }
    } finally {
      signal?.removeEventListener('abort', onParentAbort);
      ac.abort();
      await merged.catch(() => {});
    }
  });
