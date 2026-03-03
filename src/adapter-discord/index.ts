import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { readDiscordConfig, isAuthorized } from './config.js';
import { getTRPCClient } from './client.js';
import { startDaemonToDiscordForwarder } from './forwarder.js';

export async function main() {
  console.log('Discord Adapter starting...');

  const config = await readDiscordConfig();
  if (!config) {
    console.error(
      'Failed to load Discord configuration. Please ensure .clawmini/adapters/discord/config.json exists and is valid.'
    );
    process.exit(1);
  }

  const trpc = getTRPCClient();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);

    // Start forwarding from daemon to Discord
    startDaemonToDiscordForwarder(readyClient, trpc, config.authorizedUserId).catch((error) => {
      console.error('Error in daemon-to-discord forwarder:', error);
    });
  });

  client.on(Events.MessageCreate, async (message) => {
    // Ignore messages from the bot itself
    if (message.author.id === client.user?.id) return;

    // Only handle DM messages
    if (message.guild) return;

    // Check if the user is authorized
    if (!isAuthorized(message.author.id, config.authorizedUserId)) {
      console.log(
        `Unauthorized message from ${message.author.tag} (${message.author.id}) ignored.`
      );
      return;
    }

    console.log(`Received message from ${message.author.tag}: ${message.content}`);

    try {
      await trpc.sendMessage.mutate({
        type: 'send-message',
        client: 'cli', // Using 'cli' as the client type for now as daemon supports it
        data: {
          message: message.content,
        },
      });
      console.log('Message forwarded to daemon successfully.');
    } catch (error) {
      console.error('Failed to forward message to daemon:', error);
    }
  });

  try {
    await client.login(config.botToken);
  } catch (error) {
    console.error('Failed to login to Discord:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error in Discord Adapter:', error);
  process.exit(1);
});
