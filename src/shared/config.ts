import { z } from 'zod';

const PolicyDefinitionSchema = z.looseObject({
  description: z.string().optional(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  allowHelp: z.boolean().optional(),
  autoApprove: z.boolean().optional(),
});

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
  extends: z.string().optional(),
  commands: z
    .looseObject({
      new: z.string().optional(),
      append: z.string().optional(),
      getSessionId: z.string().optional(),
      getMessageContent: z.string().optional(),
    })
    .optional(),
  apiTokenEnvVar: z.string().optional(),
  apiUrlEnvVar: z.string().optional(),
  env: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
  subagentEnv: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
  modelShorthands: z.record(z.string(), z.string()).optional(),
  directory: z.string().optional(),
  // `null` explicitly disables skill install/refresh for this agent.
  // `undefined` (omitted) falls back to the template's value or `.agents/skills`.
  skillsDir: z.string().nullable().optional(),
  fallbacks: z.array(FallbackSchema).optional(),
  files: z.string().default('./attachments').optional(),
});

export type Agent = z.infer<typeof AgentSchema>;

export type CronJob = {
  id: string;
  createdAt?: string;
  message: string;
  reply?: string;
  agentId?: string;
  env?: Record<string, string | boolean>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session?: { type: string; [key: string]: any };
  schedule: { cron: string } | { every: string } | { at: string };
  nextSessionId?: string;
  action?: 'stop' | 'interrupt' | 'continue';
  jobs?: {
    add?: CronJob[];
    remove?: string[];
  };
};

export const CronJobSchema = z.lazy(() =>
  z.looseObject({
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
    nextSessionId: z.string().optional(),
    action: z.enum(['stop', 'interrupt', 'continue']).optional(),
    jobs: z
      .looseObject({
        add: z.array(z.lazy(() => CronJobSchema)).optional(),
        remove: z.array(z.string()).optional(),
      })
      .optional(),
  })
) as z.ZodType<CronJob>;

export const RouterConfigSchema = z.union([
  z.string(),
  z.looseObject({
    use: z.string(),
    with: z.record(z.string(), z.any()).optional(),
  }),
]);

export type RouterConfig = z.infer<typeof RouterConfigSchema>;

export const SubagentTrackerSchema = z.looseObject({
  id: z.string(),
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
  createdAt: z.string(),
  status: z.enum(['active', 'completed', 'failed']),
  parentId: z.string().optional(),
});

export type SubagentTracker = z.infer<typeof SubagentTrackerSchema>;

export const ChatSettingsSchema = z.looseObject({
  defaultAgent: z.string().optional(),
  sessions: z.record(z.string(), z.string()).optional(),
  routers: z.array(RouterConfigSchema).optional(),
  jobs: z.array(CronJobSchema).optional(),
  subagents: z.record(z.string(), SubagentTrackerSchema).optional(),
});

export type ChatSettings = z.infer<typeof ChatSettingsSchema>;

export const AgentSessionSettingsSchema = z.looseObject({
  env: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
});

export type AgentSessionSettings = z.infer<typeof AgentSessionSettingsSchema>;

export const EnvironmentSchema = z.looseObject({
  extends: z.string().optional(),
  init: z.string().optional(),
  up: z.string().optional(),
  down: z.string().optional(),
  prefix: z.string().optional(),
  envFormat: z.string().optional(),
  exportLiteTo: z.string().optional(),
  baseDir: z.string().optional(),
  env: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
  policies: z.record(z.string(), PolicyDefinitionSchema).optional(),
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
