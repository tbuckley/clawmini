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
  env: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
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
  env: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
  directory: z.string().optional(),
  fallbacks: z.array(FallbackSchema).optional(),
  files: z.string().default('./attachments').optional(),
});

export type Agent = z.infer<typeof AgentSchema>;

export const CronJobSchema = z.looseObject({
  id: z.string().min(1),
  createdAt: z.string().optional(),
  message: z.string().default(''),
  reply: z.string().optional(),
  agentId: z.string().optional(),
  env: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
  session: z.looseObject({ type: z.string() }).optional(),
  schedule: z.union([
    z.looseObject({ cron: z.string() }),
    z.looseObject({ every: z.string() }),
    z.looseObject({ at: z.string() }),
  ]),
});

export type CronJob = z.infer<typeof CronJobSchema>;

export const RouterConfigSchema = z.union([
  z.string(),
  z.looseObject({
    use: z.string(),
    with: z.record(z.string(), z.any()).optional(),
  }),
]);

export type RouterConfig = z.infer<typeof RouterConfigSchema>;

export const ChatSettingsSchema = z.looseObject({
  defaultAgent: z.string().optional(),
  sessions: z.record(z.string(), z.string()).optional(),
  routers: z.array(RouterConfigSchema).optional(),
  jobs: z.array(CronJobSchema).optional(),
});

export type ChatSettings = z.infer<typeof ChatSettingsSchema>;

export const AgentSessionSettingsSchema = z.looseObject({
  env: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
});

export type AgentSessionSettings = z.infer<typeof AgentSessionSettingsSchema>;

export const EnvironmentSchema = z.looseObject({
  init: z.string().optional(),
  up: z.string().optional(),
  down: z.string().optional(),
  prefix: z.string().optional(),
  envFormat: z.string().optional(),
  exportLiteTo: z.string().optional(),
  env: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

export const SettingsSchema = z.looseObject({
  chats: z
    .looseObject({
      defaultId: z.string().optional(),
    })
    .optional(),
  defaultAgent: AgentSchema.optional(),
  environments: z.record(z.string(), z.string()).optional(),
  routers: z.array(RouterConfigSchema).optional(),
  files: z.string().default('./attachments').optional(),
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
