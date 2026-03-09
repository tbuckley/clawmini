import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { isValidAgentId, enableEnvironment } from '../../shared/workspace.js';
import { setDefaultChatId } from '../../shared/chats.js';
import { type Agent } from '../../shared/config.js';
import { createAgentWithChat } from '../../shared/agent-utils.js';
import { handleError } from '../utils.js';

export const initCmd = new Command('init')
  .description('Initialize a new .clawmini settings folder')
  .option('--agent <name>', 'Initialize with a specific agent')
  .option('--agent-template <name>', 'Template to use for the agent')
  .option('--environment <name>', 'Enable a specific environment')
  .action(async (options: { agent?: string; agentTemplate?: string; environment?: string }) => {
    if (options.agentTemplate && !options.agent) {
      handleError('initialize', new Error('--agent-template cannot be used without --agent'));
    }

    if (options.agent && !isValidAgentId(options.agent)) {
      handleError('initialize', new Error(`Invalid agent ID: ${options.agent}`));
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
      routers: [
        '@clawmini/slash-new',
        '@clawmini/slash-stop',
        '@clawmini/slash-interrupt',
        '@clawmini/slash-command',
      ],
      api: true,
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
        await createAgentWithChat(agentId, agentData, options.agentTemplate);

        console.log(`Agent ${agentId} created successfully.`);

        await setDefaultChatId(agentId);
        console.log(`Default chat set to ${agentId}.`);
      } catch (err) {
        handleError('create agent', err);
      }
    }

    if (options.environment) {
      try {
        await enableEnvironment(options.environment);
      } catch (err) {
        handleError('enable environment', err);
      }
    }
  });
