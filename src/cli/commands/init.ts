import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import {
  isValidAgentId,
  writeAgentSettings,
  applyTemplateToAgent,
  readChatSettings,
  writeChatSettings,
} from '../../shared/workspace.js';
import { listChats, createChat } from '../../shared/chats.js';
import { type Agent } from '../../shared/config.js';

export const initCmd = new Command('init')
  .description('Initialize a new .clawmini settings folder')
  .option('--agent <name>', 'Initialize with a specific agent')
  .option('--agent-template <name>', 'Template to use for the agent')
  .action(async (options: { agent?: string; agentTemplate?: string }) => {
    if (options.agentTemplate && !options.agent) {
      console.error('Error: --agent-template cannot be used without --agent');
      process.exit(1);
    }

    if (options.agent && !isValidAgentId(options.agent)) {
      console.error(`Error: Invalid agent ID: ${options.agent}`);
      process.exit(1);
    }

    const cwd = process.cwd();
    const dirPath = path.join(cwd, '.clawmini');
    const settingsPath = path.join(dirPath, 'settings.json');

    if (fs.existsSync(settingsPath)) {
      console.log('.clawmini already initialized');
      return;
    }

    const defaultSettings = {
      defaultAgent: {
        commands: {
          new: 'echo $CLAW_CLI_MESSAGE',
        },
        env: {},
      },
      routers: ['@clawmini/slash-new', '@clawmini/slash-command'],
    };

    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));
    console.log('Initialized .clawmini/settings.json');

    if (options.agent) {
      try {
        const agentId = options.agent;
        const agentData: Agent = {};
        await writeAgentSettings(agentId, agentData);

        if (options.agentTemplate) {
          await applyTemplateToAgent(agentId, options.agentTemplate, agentData);
        }

        const existingChats = await listChats();
        if (existingChats.includes(agentId)) {
          console.warn(`Warning: Chat ${agentId} already exists.`);
        } else {
          await createChat(agentId);
          const currentSettings = (await readChatSettings(agentId)) || {};
          await writeChatSettings(agentId, { ...currentSettings, defaultAgent: agentId });
        }

        console.log(`Agent ${agentId} created successfully.`);

        const currentWorkspaceSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        fs.writeFileSync(
          settingsPath,
          JSON.stringify(
            {
              ...currentWorkspaceSettings,
              chats: {
                ...(currentWorkspaceSettings.chats || {}),
                defaultId: agentId,
              },
            },
            null,
            2
          )
        );
        console.log(`Default chat set to ${agentId}.`);
      } catch (err) {
        console.error('Failed to create agent:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }
  });
