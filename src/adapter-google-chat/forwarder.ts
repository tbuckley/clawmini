/* eslint-disable max-lines */
import { google } from 'googleapis';
import { getAuthClient } from './auth.js';
import type { getTRPCClient, GoogleChatApi } from './client.js';
import type { ChatMessage } from '../shared/chats.js';
import path from 'node:path';
import fs from 'node:fs';
import type { GoogleChatConfig } from './config.js';
import { readGoogleChatState, updateGoogleChatState, getGoogleChatStatePath } from './state.js';
import {
  shouldDisplayMessage,
  formatMessage,
  type FilteringConfig,
} from '../shared/adapters/filtering.js';
import { buildPolicyCard, chunkString } from './utils.js';
import { uploadFilesToDrive } from './upload.js';

export interface GoogleChatForwarderDeps {
  /** Google Chat API client (defaults to `google.chat()` with ADC credentials). */
  chatApi?: GoogleChatApi;
  /** Root directory for resolving adapter state (defaults to `process.cwd()`). */
  startDir?: string;
}

export async function startDaemonToGoogleChatForwarder(
  trpc: ReturnType<typeof getTRPCClient>,
  config: GoogleChatConfig,
  filteringConfig: FilteringConfig,
  signal?: AbortSignal,
  deps: GoogleChatForwarderDeps = {}
) {
  const defaultChatId = config.chatId || 'default';
  const startDir = deps.startDir ?? process.cwd();

  const getChatApi = async (): Promise<GoogleChatApi> => {
    if (deps.chatApi) return deps.chatApi;
    const authClient = await getAuthClient();
    return google.chat({ version: 'v1', auth: authClient });
  };

  const activeSubscriptions = new Map<string, { unsubscribe: () => void }>();
  let currentLastSyncedMessageIds =
    (await readGoogleChatState(startDir)).lastSyncedMessageIds || {};

  const saveLastMessageId = async (chatId: string, id: string) => {
    currentLastSyncedMessageIds = { ...currentLastSyncedMessageIds, [chatId]: id };
    return updateGoogleChatState(
      (state) => ({
        lastSyncedMessageIds: {
          ...state.lastSyncedMessageIds,
          ...currentLastSyncedMessageIds,
        },
      }),
      startDir
    );
  };

  const startSubscriptionForChat = async (chatId: string) => {
    if (activeSubscriptions.has(chatId)) return;
    if (signal?.aborted) return;

    let lastMessageId = currentLastSyncedMessageIds[chatId];

    if (!lastMessageId) {
      try {
        const messages = await trpc.getMessages.query({ chatId, limit: 1 });
        if (Array.isArray(messages) && messages.length > 0) {
          const lastMsg = messages[messages.length - 1];
          if (lastMsg) {
            await saveLastMessageId(chatId, lastMsg.id);
            lastMessageId = lastMsg.id;
          }
        }
      } catch (error) {
        if (signal?.aborted) return;
        console.error(`Failed to fetch initial messages from daemon for ${chatId}:`, error);
      }
    }

    console.log(
      `Starting daemon-to-google-chat forwarder for chat ${chatId}, lastMessageId: ${lastMessageId}`
    );

    let retryDelay = 1000;
    const maxRetryDelay = 30000;

    let subscription: { unsubscribe: () => void } | null = null;
    let messageQueue = Promise.resolve();

    const connect = () => {
      if (signal?.aborted || !activeSubscriptions.has(chatId)) {
        return;
      }

      subscription = trpc.waitForMessages.subscribe(
        { chatId, lastMessageId },
        {
          onData: (messages) => {
            retryDelay = 1000;

            if (!Array.isArray(messages) || messages.length === 0) {
              return;
            }

            messageQueue = messageQueue
              .then(async () => {
                for (const rawMessage of messages) {
                  if (signal?.aborted || !activeSubscriptions.has(chatId)) break;

                  const message = rawMessage as ChatMessage;

                  const isDisplayed = shouldDisplayMessage(message, filteringConfig);

                  if (isDisplayed) {
                    const logMessage = message;

                    const currentState = await readGoogleChatState(startDir);
                    let activeSpaceName: string | undefined;

                    if (!activeSpaceName && currentState.channelChatMap) {
                      const entry = Object.entries(currentState.channelChatMap).find(
                        ([_, mapChatId]) => mapChatId?.chatId === chatId
                      );
                      if (entry) {
                        activeSpaceName = entry[0];
                      }
                    }

                    // We no longer fallback to config.directMessageName. If it's not mapped, we'll drop it below.

                    const isPolicyRequest =
                      logMessage.role === 'policy' && logMessage.status === 'pending';

                    if (isPolicyRequest) {
                      if (!activeSpaceName) {
                        console.warn(
                          'No active Google Chat space to reply to. Ignoring policy request:',
                          logMessage.content
                        );
                        await saveLastMessageId(chatId, logMessage.id).catch(console.error);
                        lastMessageId = logMessage.id;
                        continue;
                      }

                      try {
                        const chatApi = await getChatApi();

                        try {
                          await chatApi.spaces.messages.create({
                            parent: activeSpaceName as string,
                            requestBody: {
                              text: '',
                              cardsV2: buildPolicyCard(logMessage),
                            },
                          });
                        } catch (richError) {
                          console.warn(
                            'Failed to send rich policy request to Google Chat, falling back to plain text:',
                            richError
                          );
                          const policyId =
                            ('requestId' in logMessage && logMessage.requestId) || logMessage.id;
                          await chatApi.spaces.messages.create({
                            parent: activeSpaceName as string,
                            requestBody: {
                              text: `Action Required: Policy Request\n\n${logMessage.content || 'A pending policy request requires your attention.'}\n\nApprove: \`/approve ${policyId}\`\nReject: \`/reject ${policyId} <optional_rationale>\``,
                            },
                          });
                        }
                      } catch (error) {
                        console.error('Failed to send policy request to Google Chat:', error);
                      }

                      await saveLastMessageId(chatId, logMessage.id).catch(console.error);
                      lastMessageId = logMessage.id;
                      continue;
                    }

                    const hasContent = !!logMessage.content?.trim();
                    const files =
                      'files' in logMessage ? (logMessage.files as string[]) : undefined;
                    const hasFiles = Array.isArray(files) && files.length > 0;

                    if (
                      ('level' in logMessage && logMessage.level === 'verbose') ||
                      (!hasContent && !hasFiles)
                    ) {
                      await saveLastMessageId(chatId, logMessage.id).catch(console.error);
                      lastMessageId = logMessage.id;
                      continue;
                    }

                    if (!activeSpaceName) {
                      console.warn(
                        'No active Google Chat space to reply to. Ignoring message:',
                        logMessage.content
                      );
                      await saveLastMessageId(chatId, logMessage.id).catch(console.error);
                      lastMessageId = logMessage.id;
                      continue;
                    }

                    try {
                      const chatApi = await getChatApi();

                      let text = formatMessage(logMessage) || '';

                      if (hasFiles && files) {
                        const fileNames = files.map((f) => path.basename(f)).join(', ');

                        if (
                          config.driveUploadEnabled !== false &&
                          config.oauthClientId &&
                          config.oauthClientSecret
                        ) {
                          text += `\n\n`;
                          try {
                            const uploadResults = await uploadFilesToDrive(files, config);
                            for (const result of uploadResults) {
                              text += `${result}\n`;
                            }
                          } catch (driveAuthErr) {
                            console.error(
                              'Drive API/Auth Failed, degrading to local files output:',
                              driveAuthErr
                            );
                            text += `*(Files generated: ${fileNames})*`;
                          }
                        } else {
                          text += `\n\n*(Files generated: ${fileNames})*`;
                        }
                      }

                      if (text.length > 4000) {
                        const chunks = chunkString(text, 4000);
                        for (let i = 0; i < chunks.length; i++) {
                          if (signal?.aborted || !activeSubscriptions.has(chatId)) break;
                          await chatApi.spaces.messages.create({
                            parent: activeSpaceName as string,
                            requestBody: { text: chunks[i] as string },
                          });
                        }
                      } else {
                        await chatApi.spaces.messages.create({
                          parent: activeSpaceName as string,
                          requestBody: { text },
                        });
                      }
                    } catch (error) {
                      console.error('Failed to send message to Google Chat:', error);
                    }
                  }

                  await saveLastMessageId(chatId, message.id).catch(console.error);
                  lastMessageId = message.id;
                }
              })
              .catch((error) => {
                console.error('Message queue failed, forcing reconnect...', error);
                subscription?.unsubscribe();
                subscription = null;
                if (signal?.aborted || !activeSubscriptions.has(chatId)) {
                  return;
                }
                setTimeout(() => {
                  retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
                  connect();
                }, retryDelay);
              });
          },
          onError: (error) => {
            console.error(
              `Error in daemon-to-google-chat forwarder subscription for ${chatId}. Retrying in ${retryDelay}ms.`,
              error
            );
            subscription?.unsubscribe();
            subscription = null;

            if (signal?.aborted || !activeSubscriptions.has(chatId)) {
              return;
            }

            setTimeout(() => {
              retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
              connect();
            }, retryDelay);
          },
          onComplete: () => {
            subscription = null;
            if (!signal?.aborted && activeSubscriptions.has(chatId)) {
              setTimeout(() => connect(), retryDelay);
            }
          },
        }
      );
    };

    activeSubscriptions.set(chatId, {
      unsubscribe: () => subscription?.unsubscribe(),
    });

    connect();
  };

  const syncSubscriptions = async () => {
    if (signal?.aborted) return;
    const state = await readGoogleChatState(startDir);

    // Update local copy of last message IDs
    if (state.lastSyncedMessageIds) {
      currentLastSyncedMessageIds = {
        ...state.lastSyncedMessageIds,
        ...currentLastSyncedMessageIds,
      };
    }

    const targetChatIds = new Set<string>();
    targetChatIds.add(defaultChatId);

    if (state.channelChatMap) {
      for (const mappedEntry of Object.values(state.channelChatMap)) {
        if (mappedEntry.chatId) {
          targetChatIds.add(mappedEntry.chatId);
        }
      }
    }

    for (const targetChatId of targetChatIds) {
      if (!activeSubscriptions.has(targetChatId)) {
        startSubscriptionForChat(targetChatId);
      }
    }

    for (const [activeChatId, sub] of activeSubscriptions.entries()) {
      if (!targetChatIds.has(activeChatId)) {
        sub.unsubscribe();
        activeSubscriptions.delete(activeChatId);
      }
    }
  };
  return new Promise<void>((resolve) => {
    syncSubscriptions().catch(console.error);

    const statePath = getGoogleChatStatePath(startDir);
    const stateDir = path.dirname(statePath);
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    let debounceTimer: NodeJS.Timeout | null = null;
    const watcher = fs.watch(stateDir, (eventType, filename) => {
      if (filename === path.basename(statePath)) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          syncSubscriptions().catch(console.error);
        }, 200);
      }
    });

    signal?.addEventListener('abort', () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher.close();
      for (const sub of activeSubscriptions.values()) sub.unsubscribe();
      resolve();
    });
  });
}
