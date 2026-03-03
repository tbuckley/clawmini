import { z } from 'zod';

export const FallbackSchema = z.looseObject({
  commands: z
    .looseObject({
      new: z.string().optional(),
      append: z.string().optional(),
      getSessionId: z.string().optional(),
      getMessageContent: z.string().optional(),
    })
    .optional(),
  env: z.record(z.string(), z.string()).optional(),
  retries: z.number().int().min(0).default(1),
  delayMs: z.number().int().min(0).default(1000),
});

export const AgentSchema = z.looseObject({
  commands: z
    .looseObject({
      new: z.string().optional(),
      append: z.string().optional(),
      getSessionId: z.string().optional(),
      getMessageContent: z.string().optional(),
    })
    .optional(),
  env: z.record(z.string(), z.string()).optional(),
  directory: z.string().optional(),
  fallbacks: z.array(FallbackSchema).optional(),
});

export type Agent = z.infer<typeof AgentSchema>;

export const CronJobSchema = z.looseObject({
  id: z.string().min(1),
  createdAt: z.string().optional(),
  message: z.string().default(''),
  reply: z.string().optional(),
  agentId: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  session: z.looseObject({ type: z.string() }).optional(),
  schedule: z.union([
    z.looseObject({ cron: z.string() }),
    z.looseObject({ every: z.string() }),
    z.looseObject({ at: z.string() }),
  ]),
});

export type CronJob = z.infer<typeof CronJobSchema>;

export const ChatSettingsSchema = z.looseObject({
  defaultAgent: z.string().optional(),
  sessions: z.record(z.string(), z.string()).optional(),
  routers: z.array(z.string()).optional(),
  jobs: z.array(CronJobSchema).optional(),
});

export type ChatSettings = z.infer<typeof ChatSettingsSchema>;

export const AgentSessionSettingsSchema = z.looseObject({
  env: z.record(z.string(), z.string()).optional(),
});

export type AgentSessionSettings = z.infer<typeof AgentSessionSettingsSchema>;

export const SettingsSchema = z.looseObject({
  chats: z
    .looseObject({
      defaultId: z.string().optional(),
    })
    .optional(),
  defaultAgent: AgentSchema.optional(),
  routers: z.array(z.string()).optional(),
  api: z
    .union([
      z.boolean(),
      z.looseObject({
        host: z.string().optional(),
        port: z.number().optional(),
        proxy_host: z.string().optional(),
      }),
    ])
    .optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;
