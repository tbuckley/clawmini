import { type Agent } from './config.js';
import {
  writeAgentSettings,
  applyTemplateToAgent,
  readChatSettings,
  writeChatSettings,
  copyAgentSkills,
} from './workspace.js';
import { createChat, listChats } from './chats.js';

export async function createAgentWithChat(
  agentId: string,
  agentData: Agent,
  template?: string,
  startDir = process.cwd()
): Promise<void> {
  await writeAgentSettings(agentId, agentData, startDir);

  if (template) {
    await applyTemplateToAgent(agentId, template, agentData, startDir);
  }

  try {
    await copyAgentSkills(agentId, startDir);
    console.log(`Copied skills to agent ${agentId}.`);
  } catch (err) {
    console.warn(
      `Warning: Failed to copy skills to agent ${agentId}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const existingChats = await listChats(startDir);
  if (existingChats.includes(agentId)) {
    console.warn(`Warning: Chat ${agentId} already exists.`);
  } else {
    await createChat(agentId, startDir);
    const currentSettings = (await readChatSettings(agentId, startDir)) || {};
    await writeChatSettings(agentId, { ...currentSettings, defaultAgent: agentId }, startDir);
  }
}
