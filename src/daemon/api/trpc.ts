import { initTRPC, TRPCError } from '@trpc/server';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TokenPayload } from '../auth.js';

export interface Context {
  req?: IncomingMessage | undefined;
  res?: ServerResponse | undefined;
  isApiServer?: boolean | undefined;
  tokenPayload?: TokenPayload | null | undefined;
}

const t = initTRPC.context<Context>().create();
export const router = t.router;
export const publicProcedure = t.procedure;

const apiAuthMiddleware = t.middleware(({ ctx, next }) => {
  if (ctx.isApiServer) {
    if (!ctx.tokenPayload) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing or invalid token' });
    }
  }
  return next({
    ctx: {
      ...ctx,
      tokenPayload: ctx.tokenPayload,
    },
  });
});

export const apiProcedure = t.procedure.use(apiAuthMiddleware);
