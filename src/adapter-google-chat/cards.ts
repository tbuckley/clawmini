import { google } from 'googleapis';
import { getAuthClient } from './auth.js';
import type { RoutingTrpcClient } from '../shared/adapters/routing.js';

type ChatApiLike = ReturnType<typeof google.chat>;

export async function handleCardClicked(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  event: any,
  targetChatId: string,
  trpc: RoutingTrpcClient,
  getChatApi?: () => Promise<ChatApiLike>
) {
  const action = event.action;
  if (!action) return;

  const methodName = action.actionMethodName;
  const params = action.parameters || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const policyIdParam = params.find((p: any) => p.key === 'policyId');
  const policyId = policyIdParam?.value;

  if (policyId && (methodName === 'approve' || methodName === 'reject')) {
    const cmd = methodName === 'approve' ? `/approve ${policyId}` : `/reject ${policyId}`;

    if (event.message?.name) {
      try {
        const chatApi = getChatApi
          ? await getChatApi()
          : google.chat({ version: 'v1', auth: await getAuthClient() });

        const originalCards = event.message.cardsV2 || [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updatedCards = originalCards.map((c: any) => {
          if (c.card?.sections) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            c.card.sections = c.card.sections.map((s: any) => {
              if (s.widgets) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                s.widgets = s.widgets.filter((w: any) => !w.buttonList);
              }
              return s;
            });
          }
          if (c.card?.header) {
            const statusText = methodName === 'approve' ? 'Approved' : 'Rejected';
            c.card.header.subtitle = `Policy ${statusText}`;
          }
          return c;
        });

        await chatApi.spaces.messages.update({
          name: event.message.name,
          updateMask: 'cardsV2',
          requestBody: {
            cardsV2: updatedCards,
          },
        });
      } catch (updateErr) {
        console.error(`Failed to update card for policy ${policyId}:`, updateErr);
      }
    }

    await trpc.sendMessage.mutate({
      type: 'send-message',
      client: 'cli',
      data: {
        message: cmd,
        chatId: targetChatId,
        adapter: 'google-chat',
        noWait: true,
      },
    });
    console.log(`Forwarded ${methodName} for policy ${policyId} to daemon.`);
  }
}
