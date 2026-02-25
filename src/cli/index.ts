#!/usr/bin/env node
import { Command } from 'commander';
import { initCmd } from './commands/init.js';
import { messagesCmd } from './commands/messages.js';
import { chatsCmd } from './commands/chats.js';
import { downCmd } from './commands/down.js';
import { upCmd } from './commands/up.js';
import { webCmd } from './commands/web.js';

const program = new Command();

program.name('clawmini').description('Clawmini CLI').version('0.0.1');

program.addCommand(initCmd);
program.addCommand(messagesCmd);
program.addCommand(chatsCmd);
program.addCommand(downCmd);
program.addCommand(upCmd);
program.addCommand(webCmd);

program.parse();
