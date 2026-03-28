import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Interaction,
} from 'discord.js';
import { readDiscordState } from './state.js';
import type { DiscordConfig } from './config.js';

function isAuthorized(userId: string, authorizedUserId: string): boolean {
  return userId === authorizedUserId;
}

export async function handleDiscordInteraction(
  interaction: Interaction,
  config: DiscordConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trpc: any
) {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return;

  if (!isAuthorized(interaction.user.id, config.authorizedUserId)) {
    if (interaction.isRepliable()) {
      await interaction.reply({
        content: 'You are not authorized to perform this action.',
        ephemeral: true,
      });
    }
    return;
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('approve_')) {
      const policyId = interaction.customId.replace('approve_', '');
      await interaction.update({ components: [] });
      await interaction.followUp({ content: `Approving policy ${policyId}...`, ephemeral: true });
      try {
        const currentState = await readDiscordState();
        const targetChatId = interaction.channelId
          ? currentState.channelChatMap?.[interaction.channelId] || config.chatId
          : config.chatId;
        await trpc.sendMessage.mutate({
          type: 'send-message',
          client: 'cli',
          data: {
            message: `/approve ${policyId}`,
            chatId: targetChatId,
            adapter: 'discord',
            noWait: true,
          },
        });
      } catch (error) {
        console.error('Failed to send approve command to daemon:', error);
        await interaction.followUp({
          content: `Failed to approve policy ${policyId}.`,
          ephemeral: true,
        });
      }
    } else if (interaction.customId.startsWith('reject_')) {
      const policyId = interaction.customId.replace('reject_', '');

      const modal = new ModalBuilder()
        .setCustomId(`modal_reject_${policyId}`)
        .setTitle('Reject Policy');

      const rationaleInput = new TextInputBuilder()
        .setCustomId('rationale')
        .setLabel('Rationale (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

      const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(rationaleInput);
      modal.addComponents(actionRow);

      await interaction.showModal(modal);
    }
  } else if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('modal_reject_')) {
      const policyId = interaction.customId.replace('modal_reject_', '');
      const rationale = interaction.fields.getTextInputValue('rationale');

      const command = rationale ? `/reject ${policyId} ${rationale}` : `/reject ${policyId}`;

      if (interaction.isFromMessage()) {
        await interaction.update({ components: [] });
        await interaction.followUp({
          content: `Rejecting policy ${policyId}...`,
          ephemeral: true,
        });
      } else {
        await interaction.reply({ content: `Rejecting policy ${policyId}...`, ephemeral: true });
      }

      try {
        await trpc.sendMessage.mutate({
          type: 'send-message',
          client: 'cli',
          data: {
            message: command,
            chatId: config.chatId,
            adapter: 'discord',
            noWait: true,
          },
        });
      } catch (error) {
        console.error('Failed to send reject command to daemon:', error);
        await interaction.followUp({
          content: `Failed to reject policy ${policyId}.`,
          ephemeral: true,
        });
      }
    }
  }
}
