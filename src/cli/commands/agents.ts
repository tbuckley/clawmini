import { Command } from 'commander';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import fs from 'node:fs';
import {
  listAgents,
  getAgent,
  writeAgentSettings,
  deleteAgent,
  isValidAgentId,
  getWorkspaceRoot,
} from '../../shared/workspace.js';
import type { Agent } from '../../shared/config.js';

export const agentsCmd = new Command('agents').description('Manage agents');

async function createAgentDirectory(agentId: string, directory?: string) {
  const workspaceRoot = getWorkspaceRoot();
  const dirPath = directory
    ? path.resolve(workspaceRoot, directory)
    : path.resolve(workspaceRoot, agentId);

  // Security check: Ensure the resolved path is within the workspace root
  const rootWithSep = workspaceRoot.endsWith(path.sep) ? workspaceRoot : workspaceRoot + path.sep;
  if (!dirPath.startsWith(rootWithSep) && dirPath !== workspaceRoot) {
    throw new Error(`Invalid agent directory: ${directory} resolves outside the workspace.`);
  }

  if (!fs.existsSync(dirPath)) {
    await fsPromises.mkdir(dirPath, { recursive: true });
    console.log(`Created agent directory at ${dirPath}`);
  }
}

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
      console.error('Failed to list agents:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

agentsCmd
  .command('add <id>')
  .description('Create a new agent')
  .option('-d, --directory <dir>', 'Working directory for the agent')
  .option(
    '-e, --env <env...>',
    'Environment variables in KEY=VALUE format (can be specified multiple times)'
  )
  .action(async (id: string, options: { directory?: string; env?: string[] }) => {
    try {
      if (!isValidAgentId(id)) {
        throw new Error(`Invalid agent ID: ${id}`);
      }
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
        agentData.env = env;
      }

      await writeAgentSettings(id, agentData);
      await createAgentDirectory(id, agentData.directory);
      console.log(`Agent ${id} created successfully.`);
    } catch (err) {
      console.error('Failed to create agent:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

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
      if (!isValidAgentId(id)) {
        throw new Error(`Invalid agent ID: ${id}`);
      }
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
      console.error('Failed to update agent:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

agentsCmd
  .command('delete <id>')
  .description('Remove an agent')
  .action(async (id: string) => {
    try {
      if (!isValidAgentId(id)) {
        throw new Error(`Invalid agent ID: ${id}`);
      }
      const existing = await getAgent(id);
      if (!existing) {
        throw new Error(`Agent ${id} does not exist.`);
      }

      await deleteAgent(id);
      console.log(`Agent ${id} deleted successfully.`);
    } catch (err) {
      console.error('Failed to delete agent:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
