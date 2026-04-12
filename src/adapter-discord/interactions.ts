import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Interaction,
} from 'discord.js';
import type { DiscordConfig } from './config.js';
import { readDiscordState } from './state.js';
import { type FilteringConfig } from '../shared/adapters/filtering.js';
import { processDiscordMessage } from './processMessage.js';

function isAuthorized(userId: string, authorizedUserId: string): boolean {
  return userId === authorizedUserId;
}

export async function handleDiscordInteraction(
  interaction: Interaction,
  config: DiscordConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trpc: any,
  filteringConfig: FilteringConfig
) {
  if (
    !interaction.isButton() &&
    !interaction.isModalSubmit() &&
    !interaction.isChatInputCommand()
  ) {
    return;
  }

  if (!isAuthorized(interaction.user.id, config.authorizedUserId)) {
    if (interaction.isRepliable()) {
      await interaction.reply({
        content: 'You are not authorized to perform this action.',
        ephemeral: true,
      });
    }
    return;
  }

  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;
    let commandStr = `/${commandName}`;

    if (commandName === 'approve' || commandName === 'reject') {
      const policyId = interaction.options.getString('policy_id');
      if (policyId) commandStr += ` ${policyId}`;
    }
    if (commandName === 'reject') {
      const rationale = interaction.options.getString('rationale');
      if (rationale) commandStr += ` ${rationale}`;
    }

    await interaction.deferReply({ ephemeral: true });

    const currentState = await readDiscordState();
    const targetChatId = interaction.channelId
      ? currentState.channelChatMap?.[interaction.channelId]?.chatId || config.chatId
      : config.chatId;

    await processDiscordMessage(
      commandStr,
      interaction.user,
      interaction.channelId,
      interaction.guild,
      async (text) => {
        await interaction.followUp({ content: text, ephemeral: true });
      },
      config,
      trpc,
      filteringConfig,
      { explicitChatId: targetChatId, mentionsBot: true }
    );
    return;
  }

  if (interaction.isButton()) {
    if (
      interaction.customId.startsWith('approve_') ||
      interaction.customId.startsWith('approve|')
    ) {
      let policyId, explicitChatId;
      if (interaction.customId.startsWith('approve|')) {
        const parts = interaction.customId.split('|');
        policyId = parts[1];
        explicitChatId = parts[2] || undefined;
      } else {
        policyId = interaction.customId.replace('approve_', '');
      }

      await interaction.update({ components: [] });
      await interaction.followUp({ content: `Approving policy ${policyId}...`, ephemeral: true });

      const currentState = await readDiscordState();
      const targetChatId =
        explicitChatId ||
        (interaction.channelId
          ? currentState.channelChatMap?.[interaction.channelId]?.chatId || config.chatId
          : config.chatId);

      await processDiscordMessage(
        `/approve ${policyId}`,
        interaction.user,
        interaction.channelId,
        interaction.guild,
        async (text) => {
          await interaction.followUp({ content: text, ephemeral: true });
        },
        config,
        trpc,
        filteringConfig,
        { explicitChatId: targetChatId, mentionsBot: true }
      );
    } else if (
      interaction.customId.startsWith('reject_') ||
      interaction.customId.startsWith('reject|')
    ) {
      let policyId, explicitChatId;
      if (interaction.customId.startsWith('reject|')) {
        const parts = interaction.customId.split('|');
        policyId = parts[1];
        explicitChatId = parts[2] || '';
      } else {
        policyId = interaction.customId.replace('reject_', '');
        explicitChatId = '';
      }

      const modal = new ModalBuilder()
        .setCustomId(`modal_reject|${policyId}|${explicitChatId}`)
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
    if (
      interaction.customId.startsWith('modal_reject_') ||
      interaction.customId.startsWith('modal_reject|')
    ) {
      let policyId, explicitChatId;
      if (interaction.customId.startsWith('modal_reject|')) {
        const parts = interaction.customId.split('|');
        policyId = parts[1];
        explicitChatId = parts[2] || undefined;
      } else {
        policyId = interaction.customId.replace('modal_reject_', '');
      }
      const rationale = interaction.fields.getTextInputValue('rationale');

      const command = rationale ? `/reject ${policyId} ${rationale}` : `/reject ${policyId}`;

      if (interaction.isFromMessage()) {
        await interaction.update({ components: [] });
        await interaction.followUp({
          content: `Rejecting policy ${policyId}...`,
          ephemeral: true,
        });
      } else {
        await interaction.deferReply({ ephemeral: true });
        await interaction.followUp({ content: `Rejecting policy ${policyId}...`, ephemeral: true });
      }

      const currentState = await readDiscordState();
      const targetChatId =
        explicitChatId ||
        (interaction.channelId
          ? currentState.channelChatMap?.[interaction.channelId]?.chatId || config.chatId
          : config.chatId);

      await processDiscordMessage(
        command,
        interaction.user,
        interaction.channelId,
        interaction.guild,
        async (text) => {
          await interaction.followUp({ content: text, ephemeral: true });
        },
        config,
        trpc,
        filteringConfig,
        { explicitChatId: targetChatId, mentionsBot: true }
      );
    }
  }
}
