#!/usr/bin/env node
import { Command } from 'commander';
import { initCmd } from './commands/init.js';
import { messagesCmd } from './commands/messages.js';
import { chatsCmd } from './commands/chats.js';
import { agentsCmd } from './commands/agents.js';
import { downCmd } from './commands/down.js';
import { upCmd } from './commands/up.js';
import { webCmd } from './commands/web.js';
import { jobsCmd } from './commands/jobs.js';
import { exportLiteCmd } from './commands/export-lite.js';
import { environmentsCmd } from './commands/environments.js';
import { policiesCmd } from './commands/policies.js';
import { skillsCmd } from './commands/skills.js';

const program = new Command();

program.name('clawmini').description('Clawmini CLI').version('0.0.1');

program.addCommand(initCmd);
program.addCommand(messagesCmd);
program.addCommand(chatsCmd);
program.addCommand(agentsCmd);
program.addCommand(environmentsCmd);
program.addCommand(skillsCmd);
program.addCommand(downCmd);
program.addCommand(upCmd);
program.addCommand(webCmd);
program.addCommand(jobsCmd);
program.addCommand(exportLiteCmd);
program.addCommand(policiesCmd);

program.parse();
