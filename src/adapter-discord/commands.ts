import { SlashCommandBuilder } from 'discord.js';

export const slashCommands = [
  new SlashCommandBuilder().setName('new').setDescription('Start a new chat or operation.'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop the current operation.'),
  new SlashCommandBuilder()
    .setName('approve')
    .setDescription('Approve a pending policy request.')
    .addStringOption((option) =>
      option
        .setName('policy_id')
        .setDescription('The ID of the policy to approve')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('reject')
    .setDescription('Reject a pending policy request.')
    .addStringOption((option) =>
      option.setName('policy_id').setDescription('The ID of the policy to reject').setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('rationale')
        .setDescription('Optional rationale for rejecting the policy')
        .setRequired(false)
    ),
  new SlashCommandBuilder().setName('pending').setDescription('List pending policy requests.'),
  new SlashCommandBuilder().setName('show').setDescription('Show background messages.'),
  new SlashCommandBuilder().setName('hide').setDescription('Hide background messages.'),
  new SlashCommandBuilder()
    .setName('debug')
    .setDescription('Output debug information about ignored background messages.'),
];
