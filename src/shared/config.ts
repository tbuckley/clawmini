import { z } from 'zod';

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
});

export type Agent = z.infer<typeof AgentSchema>;

export const SettingsSchema = z.looseObject({
  chats: z
    .looseObject({
      defaultId: z.string().optional(),
    })
    .optional(),
  defaultAgent: AgentSchema.optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;
