import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';

export const initCmd = new Command('init')
  .description('Initialize a new .clawmini settings folder')
  .action(() => {
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
        routers: ['@clawmini/slash-new', '@clawmini/slash-command'],
      },
    };

    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2));
    console.log('Initialized .clawmini/settings.json');
  });
