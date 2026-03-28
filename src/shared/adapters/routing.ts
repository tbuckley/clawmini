export type RoutingTrpcClient = {
  getChats: { query: () => Promise<string[]> };
  getAgents: { query: () => Promise<string[]> };
  createChat: {
    mutation: (args: {
      chatId: string;
      agent?: string;
    }) => Promise<{ success: boolean; chatId: string }>;
  };
  sendMessage: {
    mutate: (args: {
      type: 'send-message';
      client: 'cli';
      data: {
        message: string;
        chatId?: string;
        agentId?: string;
        adapter?: string;
        noWait?: boolean;
      };
    }) => Promise<{ success: boolean }>;
  };
};

export type RoutingCommandResult =
  | { type: 'reply'; text: string }
  | { type: 'mapped'; text: string; newChatId: string }
  | null;

export async function handleRoutingCommand(
  content: string,
  externalContextId: string,
  currentChannelChatMap: Record<string, string>,
  adapterName: string,
  trpcClient: RoutingTrpcClient
): Promise<RoutingCommandResult> {
  const trimmed = content.trim();

  if (trimmed.startsWith('/chat')) {
    const args = trimmed.split(/\s+/).slice(1);
    const chatId = args[0];

    const availableChats = await trpcClient.getChats.query();

    if (!chatId || !availableChats.includes(chatId)) {
      const formattedList =
        availableChats.length > 0
          ? availableChats.map((c) => `- ${c}`).join('\n')
          : 'No chats available.';
      return {
        type: 'reply',
        text: `Available chats:\n${formattedList}\n\nPlease specify a valid chat ID: \`/chat [chat-id]\``,
      };
    }

    // Strict 1:1 Mapping Constraint
    for (const [channelId, mappedId] of Object.entries(currentChannelChatMap)) {
      if (mappedId === chatId && channelId !== externalContextId) {
        return {
          type: 'reply',
          text: `Error: Chat \`${chatId}\` is already mapped to another channel/space. Strict 1:1 mapping is required.`,
        };
      }
    }

    return {
      type: 'mapped',
      text: `Successfully mapped this channel/space to chat \`${chatId}\`.`,
      newChatId: chatId,
    };
  }

  if (trimmed.startsWith('/agent')) {
    const args = trimmed.split(/\s+/).slice(1);
    const agentId = args[0];

    const availableAgents = await trpcClient.getAgents.query();

    if (!agentId || !availableAgents.includes(agentId)) {
      const formattedList =
        availableAgents.length > 0
          ? availableAgents.map((a) => `- ${a}`).join('\n')
          : 'No agents available.';
      return {
        type: 'reply',
        text: `Available agents:\n${formattedList}\n\nPlease specify a valid agent ID: \`/agent [agent-id]\``,
      };
    }

    const availableChats = await trpcClient.getChats.query();
    let newChatId = `${agentId}-${adapterName}`;
    let counter = 1;

    while (availableChats.includes(newChatId)) {
      newChatId = `${agentId}-${adapterName}-${counter}`;
      counter++;
    }

    await trpcClient.createChat.mutation({ chatId: newChatId, agent: agentId });

    return {
      type: 'mapped',
      text: `Successfully created new chat \`${newChatId}\` with agent \`${agentId}\` and mapped it to this channel/space.`,
      newChatId,
    };
  }

  return null;
}
