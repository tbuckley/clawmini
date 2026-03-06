import { Command } from 'commander';
import {
  listAgents,
  getAgent,
  writeAgentSettings,
  deleteAgent,
  isValidAgentId,
} from '../../shared/workspace.js';
import { type Agent } from '../../shared/config.js';
import { createAgentWithChat } from '../../shared/agent-utils.js';
import { handleError } from '../utils.js';

export const agentsCmd = new Command('agents').description('Manage agents');

function parseEnv(envArray: string[] | undefined): Record<string, string> | undefined {
  if (!envArray || envArray.length === 0) return undefined;
  const env: Record<string, string> = {};
  for (const e of envArray) {
    const [key, ...rest] = e.split('=');
    if (key && rest.length >= 0) {
      env[key] = rest.join('=');
    }
  }
  return env;
}

function assertValidAgentId(id: string): void {
  if (!isValidAgentId(id)) {
    throw new Error(`Invalid agent ID: ${id}`);
  }
}

agentsCmd
  .command('list')
  .description('Display existing agents')
  .action(async () => {
    try {
      const agents = await listAgents();
      if (agents.length === 0) {
        console.log('No agents found.');
        return;
      }
      for (const id of agents) {
        console.log(`- ${id}`);
      }
    } catch (err) {
      handleError('list agents', err);
    }
  });

agentsCmd
  .command('add <id>')
  .description('Create a new agent')
  .option('-d, --directory <dir>', 'Working directory for the agent')
  .option('-t, --template <name>', 'Template to use for the agent')
  .option(
    '-e, --env <env...>',
    'Environment variables in KEY=VALUE format (can be specified multiple times)'
  )
  .action(
    async (id: string, options: { directory?: string; template?: string; env?: string[] }) => {
      try {
        assertValidAgentId(id);
        const existing = await getAgent(id);
        if (existing) {
          throw new Error(`Agent ${id} already exists.`);
        }

        const agentData: Agent = {};

        if (options.directory) {
          agentData.directory = options.directory;
        }
        const env = parseEnv(options.env);
        if (env) {
          agentData.env = { ...(agentData.env || {}), ...env };
        }

        await createAgentWithChat(id, agentData, options.template);

        console.log(`Agent ${id} created successfully.`);
      } catch (err) {
        handleError('create agent', err);
      }
    }
  );

agentsCmd
  .command('update <id>')
  .description('Update an existing agent')
  .option('-d, --directory <dir>', 'Working directory for the agent')
  .option(
    '-e, --env <env...>',
    'Environment variables in KEY=VALUE format (can be specified multiple times)'
  )
  .action(async (id: string, options: { directory?: string; env?: string[] }) => {
    try {
      assertValidAgentId(id);
      const existing = await getAgent(id);
      if (!existing) {
        throw new Error(`Agent ${id} does not exist.`);
      }

      const agentData: Agent = { ...existing };

      if (options.directory !== undefined) {
        agentData.directory = options.directory;
      }

      const env = parseEnv(options.env);
      if (env) {
        agentData.env = { ...(agentData.env || {}), ...env };
      }

      await writeAgentSettings(id, agentData);
      console.log(`Agent ${id} updated successfully.`);
    } catch (err) {
      handleError('update agent', err);
    }
  });

agentsCmd
  .command('delete <id>')
  .description('Remove an agent')
  .action(async (id: string) => {
    try {
      assertValidAgentId(id);
      const existing = await getAgent(id);
      if (!existing) {
        throw new Error(`Agent ${id} does not exist.`);
      }

      await deleteAgent(id);
      console.log(`Agent ${id} deleted successfully.`);
    } catch (err) {
      handleError('delete agent', err);
    }
  });
