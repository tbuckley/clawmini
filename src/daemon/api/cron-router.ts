import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { CronJobSchema } from '../../shared/config.js';
import { apiProcedure } from './trpc.js';
import { listCronJobsShared, addCronJobShared, deleteCronJobShared } from './router-utils.js';

export const agentListCronJobs = apiProcedure.query(async ({ ctx }) => {
  if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
  const chatId = ctx.tokenPayload.chatId;
  return listCronJobsShared(chatId);
});

export const agentAddCronJob = apiProcedure
  .input(z.object({ job: CronJobSchema }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    const job = { ...input.job, agentId: ctx.tokenPayload.agentId };
    return addCronJobShared(chatId, job);
  });

export const agentDeleteCronJob = apiProcedure
  .input(z.object({ id: z.string() }))
  .mutation(async ({ input, ctx }) => {
    if (!ctx.tokenPayload) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing token' });
    const chatId = ctx.tokenPayload.chatId;
    return deleteCronJobShared(chatId, input.id);
  });
