import { type Agent } from './config.js';
import {
  writeAgentSettings,
  applyTemplateToAgent,
  readChatSettings,
  writeChatSettings,
  copyAgentSkills,
  refreshAgentSkills,
  getAgent,
} from './workspace.js';
import { createChat, listChats } from './chats.js';

export async function createAgentWithChat(
  agentId: string,
  agentData: Agent,
  template?: string,
  startDir = process.cwd(),
  opts: { fork?: boolean; force?: boolean } = {}
): Promise<void> {
  await writeAgentSettings(agentId, agentData, startDir);

  if (template) {
    await applyTemplateToAgent(agentId, template, agentData, startDir, opts);
  }

  try {
    const resolved = await getAgent(agentId, startDir);
    if (resolved?.skillsDir === null) {
      console.log(`Skipping skills for agent ${agentId} (skillsDir is null).`);
    } else if (opts.fork || !template) {
      // Fork mode (or untemplated agents) keeps the legacy bulk-copy flow.
      await copyAgentSkills(agentId, startDir);
      console.log(`Copied skills to agent ${agentId}.`);
    } else if (resolved) {
      await refreshAgentSkills(agentId, resolved, startDir, { firstInstall: true });
      console.log(`Installed skills for agent ${agentId}.`);
    }
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
