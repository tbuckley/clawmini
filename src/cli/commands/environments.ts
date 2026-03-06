import { Command } from 'commander';
import {
  copyEnvironmentTemplate,
  getEnvironmentPath,
  readSettings,
  writeSettings,
  readEnvironment,
} from '../../shared/workspace.js';
import { handleError } from '../utils.js';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

export const environmentsCmd = new Command('environments').description('Manage environments');

environmentsCmd
  .command('enable <name>')
  .description('Enable an environment for a path in the workspace')
  .option('-p, --path <subpath>', 'Path to apply the environment to', './')
  .action(async (name: string, options: { path: string }) => {
    try {
      const targetDir = getEnvironmentPath(name);

      // Copy template to targetDir if it does not already exist
      if (!fs.existsSync(targetDir)) {
        await copyEnvironmentTemplate(name, targetDir);
        console.log(`Copied environment template '${name}'.`);
      } else {
        console.log(`Environment template '${name}' already exists in workspace.`);
      }

      const settings = (await readSettings()) || {};
      const environments = settings.environments || {};

      environments[options.path] = name;
      settings.environments = environments;

      await writeSettings(settings);
      console.log(`Enabled environment '${name}' for path '${options.path}'.`);

      // Execute init command if present
      const envConfig = await readEnvironment(name);
      if (envConfig?.init) {
        console.log(`Executing init command for environment '${name}': ${envConfig.init}`);
        execSync(envConfig.init, { cwd: targetDir, stdio: 'inherit' });
      }
    } catch (err) {
      handleError('enable environment', err);
    }
  });

environmentsCmd
  .command('disable')
  .description('Disable an environment mapping')
  .option('-p, --path <subpath>', 'Path to remove the environment from', './')
  .action(async (options: { path: string }) => {
    try {
      const settings = await readSettings();
      if (!settings?.environments || !settings.environments[options.path]) {
        console.log(`No environment mapping found for path '${options.path}'.`);
        return;
      }

      const name = settings.environments[options.path];
      delete settings.environments[options.path];
      await writeSettings(settings);

      console.log(`Disabled environment '${name}' for path '${options.path}'.`);
    } catch (err) {
      handleError('disable environment', err);
    }
  });
