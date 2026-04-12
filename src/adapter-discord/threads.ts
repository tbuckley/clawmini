export interface DiscordMessageContext {
  channelId: string;
  messageId: string;
}

export const messageMappings = new Map<
  string,
  { context: DiscordMessageContext; timestamp: number }
>();

// Periodically clean up mappings older than 24 hours
setInterval(
  () => {
    const now = Date.now();
    for (const [id, data] of messageMappings.entries()) {
      if (now - data.timestamp > 24 * 60 * 60 * 1000) {
        messageMappings.delete(id);
      }
    }
  },
  60 * 60 * 1000
).unref();

export function storeMessageMapping(
  adapterMessageId: string,
  channelId: string,
  messageId: string
) {
  messageMappings.set(adapterMessageId, {
    context: { channelId, messageId },
    timestamp: Date.now(),
  });
}

export function getMessageMapping(adapterMessageId: string): DiscordMessageContext | undefined {
  return messageMappings.get(adapterMessageId)?.context;
}
