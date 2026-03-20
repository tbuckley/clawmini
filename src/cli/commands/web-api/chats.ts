import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  listChats,
  getMessages,
  getChatsDir,
  createChat,
  isValidChatId,
  getChatRelativePath,
} from '../../../shared/chats.js';
import { writeChatSettings } from '../../../shared/workspace.js';
import { getDaemonClient } from '../../client.js';
import { parseJsonBody, sendJsonResponse } from './utils.js';

export async function handleApiChats(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  urlPath: string
) {
  if (req.method === 'GET' && urlPath === '/api/chats') {
    const chats = await listChats();
    sendJsonResponse(res, 200, chats);
    return true;
  }

  if (req.method === 'POST' && urlPath === '/api/chats') {
    try {
      const schema = z.object({
        id: z.string().refine(isValidChatId, {
          message: 'Invalid chat ID. Must be alphanumeric with dashes or underscores.',
        }),
        agent: z.string().optional(),
      });

      const body = await parseJsonBody(req, schema);

      await createChat(body.id);
      if (body.agent) {
        await writeChatSettings(body.id, { defaultAgent: body.agent });
      }
      sendJsonResponse(res, 201, { id: body.id, agent: body.agent });
    } catch {
      sendJsonResponse(res, 500, { error: 'Failed to create chat' });
    }
    return true;
  }

  const chatMatch = urlPath.match(/^\/api\/chats\/([^/]+)$/);
  if (req.method === 'GET' && chatMatch && chatMatch[1]) {
    const chatId = chatMatch[1];
    try {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const since = url.searchParams.get('since');

      let messages = await getMessages(chatId);

      if (since) {
        const sinceIndex = messages.findIndex((m) => m.id === since);
        if (sinceIndex !== -1) {
          messages = messages.slice(sinceIndex + 1);
        }
      }

      sendJsonResponse(res, 200, messages);
    } catch {
      sendJsonResponse(res, 404, { error: 'Chat not found' });
    }
    return true;
  }

  const streamMatch = urlPath.match(/^\/api\/chats\/([^/]+)\/stream$/);
  if (req.method === 'GET' && streamMatch && streamMatch[1]) {
    const chatId = streamMatch[1];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    const chatsDir = await getChatsDir();
    const chatFile = path.join(chatsDir, getChatRelativePath(chatId), 'chat.jsonl');

    if (!fs.existsSync(chatFile)) {
      await createChat(chatId);
    }

    let currentSize = fs.statSync(chatFile).size;

    const watcher = fs.watch(chatFile, (eventType) => {
      if (eventType === 'change') {
        try {
          const stat = fs.statSync(chatFile);
          if (stat.size > currentSize) {
            const stream = fs.createReadStream(chatFile, {
              start: currentSize,
              end: stat.size - 1,
            });
            currentSize = stat.size;

            let buffer = '';
            stream.on('data', (chunk) => {
              buffer += chunk.toString();
              const parts = buffer.split('\n');
              buffer = parts.pop() || '';
              for (const line of parts) {
                if (line.trim()) {
                  res.write(`data: ${line}\n\n`);
                }
              }
            });
            stream.on('end', () => {
              if (buffer.trim()) {
                res.write(`data: ${buffer}\n\n`);
              }
            });
          }
        } catch {
          // File might be temporarily inaccessible
        }
      }
    });

    req.on('close', () => {
      watcher.close();
    });

    // Send an initial ping to establish connection
    res.write(': connected\n\n');
    return true;
  }

  const messageMatch = urlPath.match(/^\/api\/chats\/([^/]+)\/messages$/);
  if (req.method === 'POST' && messageMatch && messageMatch[1]) {
    const chatId = messageMatch[1];

    const schema = z.object({
      message: z.string().min(1, 'Missing or invalid "message" field'),
    });

    let body;
    try {
      body = await parseJsonBody(req, schema);
    } catch (err) {
      sendJsonResponse(res, 400, {
        error: err instanceof Error ? err.message : 'Invalid request',
      });
      return true;
    }

    try {
      const client = await getDaemonClient();
      await client.sendMessage.mutate({
        type: 'send-message',
        client: 'cli',
        data: {
          message: body.message,
          chatId,
          noWait: true,
        },
      });
      sendJsonResponse(res, 200, { success: true });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      sendJsonResponse(res, 500, { error: errorMessage || 'Internal Server Error' });
    }
    return true;
  }

  const cronMatch = urlPath.match(/^\/api\/chats\/([^/]+)\/cron(?:\/([^/]+))?$/);
  if (cronMatch && cronMatch[1]) {
    const chatId = cronMatch[1];
    const jobId = cronMatch[2]; // undefined if not present

    if (req.method === 'GET') {
      try {
        const client = await getDaemonClient();
        const jobs = await client.listCronJobs.query({ chatId });
        sendJsonResponse(res, 200, jobs);
      } catch {
        sendJsonResponse(res, 500, { error: 'Failed to list cron jobs' });
      }
      return true;
    }

    if (req.method === 'POST') {
      try {
        const client = await getDaemonClient();
        const body = await parseJsonBody(req);
        await client.addCronJob.mutate({ chatId, job: body });
        sendJsonResponse(res, 201, { success: true });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        sendJsonResponse(res, 500, { error: errorMessage || 'Failed to add cron job' });
      }
      return true;
    }

    if (req.method === 'DELETE' && jobId) {
      try {
        const client = await getDaemonClient();
        await client.deleteCronJob.mutate({ chatId, id: jobId });
        sendJsonResponse(res, 200, { success: true });
      } catch {
        sendJsonResponse(res, 500, { error: 'Failed to delete cron job' });
      }
      return true;
    }
  }

  return false;
}
