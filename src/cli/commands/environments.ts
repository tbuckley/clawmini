import { Command } from 'commander';
import { readSettings, writeSettings, enableEnvironment } from '../../shared/workspace.js';
import { handleError } from '../utils.js';

export const environmentsCmd = new Command('environments').description('Manage environments');

environmentsCmd
  .command('enable <name>')
  .description('Enable an environment for a path in the workspace')
  .option('-p, --path <subpath>', 'Path to apply the environment to', './')
  .option('--fork', 'Clone the built-in template directory instead of writing a thin overlay')
  .action(async (name: string, options: { path: string; fork?: boolean }) => {
    try {
      await enableEnvironment(
        name,
        options.path,
        process.cwd(),
        options.fork ? { fork: true } : {}
      );
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
