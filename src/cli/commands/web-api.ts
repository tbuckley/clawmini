/* eslint-disable max-lines */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ZodType } from 'zod';
import {
  listChats,
  getMessages,
  getChatsDir,
  createChat,
  isValidChatId,
} from '../../shared/chats.js';
import { getDaemonClient } from '../client.js';
import {
  listAgents,
  getAgent,
  writeAgentSettings,
  writeChatSettings,
  deleteAgent,
  isValidAgentId,
} from '../../shared/workspace.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function parseJsonBody<T = any>(
  req: http.IncomingMessage,
  schema?: ZodType<T>
): Promise<T> {
  if (req.headers['content-type'] !== 'application/json') {
    throw new Error('Invalid Content-Type');
  }
  let bodyStr = '';
  for await (const chunk of req) {
    bodyStr += chunk;
  }
  const rawBody = JSON.parse(bodyStr);
  if (schema) {
    return schema.parse(rawBody);
  }
  return rawBody as T;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sendJsonResponse(res: http.ServerResponse, statusCode: number, data: any) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export async function handleApiAgents(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  urlPath: string
) {
  if (req.method === 'GET' && urlPath === '/api/agents') {
    const agentIds = await listAgents();
    const agents = [];
    for (const id of agentIds) {
      const agent = await getAgent(id);
      if (agent) {
        agents.push({ id, ...agent });
      }
    }
    sendJsonResponse(res, 200, agents);
    return true;
  }

  if (req.method === 'POST' && urlPath === '/api/agents') {
    try {
      const schema = z.object({
        id: z.string().refine(isValidAgentId, { message: 'Invalid agent ID' }),
        directory: z.string().optional(),
        env: z.record(z.string(), z.string()).optional(),
        commands: z.record(z.string(), z.string()).optional(),
      });

      const body = await parseJsonBody(req, schema);

      const existing = await getAgent(body.id);
      if (existing) {
        sendJsonResponse(res, 409, { error: 'Agent already exists' });
        return true;
      }

      const newAgent = {
        directory: body.directory,
        env: body.env || {},
        commands: body.commands || {},
      };

      try {
        await writeAgentSettings(body.id, newAgent);
      } catch (err) {
        sendJsonResponse(res, 400, {
          error: err instanceof Error ? err.message : 'Invalid agent directory',
        });
        return true;
      }

      sendJsonResponse(res, 201, { id: body.id, ...newAgent });
    } catch {
      sendJsonResponse(res, 500, { error: 'Failed to create agent' });
    }
    return true;
  }

  const agentMatch = urlPath.match(/^\/api\/agents\/([^/]+)$/);
  if (agentMatch && agentMatch[1]) {
    const agentId = agentMatch[1];

    if (!isValidAgentId(agentId)) {
      sendJsonResponse(res, 400, { error: 'Invalid agent ID' });
      return true;
    }

    if (req.method === 'GET') {
      const agent = await getAgent(agentId);
      if (!agent) {
        sendJsonResponse(res, 404, { error: 'Agent not found' });
        return true;
      }
      sendJsonResponse(res, 200, { id: agentId, ...agent });
      return true;
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      try {
        const schema = z.object({
          directory: z.string().optional(),
          env: z.record(z.string(), z.string()).optional(),
          commands: z.record(z.string(), z.string()).optional(),
        });

        const body = await parseJsonBody(req, schema);

        const agent = (await getAgent(agentId)) || {};
        if (body.directory !== undefined) agent.directory = body.directory;
        if (body.env !== undefined) agent.env = body.env;
        if (body.commands !== undefined) agent.commands = body.commands;

        try {
          await writeAgentSettings(agentId, agent);
        } catch (err) {
          sendJsonResponse(res, 400, {
            error: err instanceof Error ? err.message : 'Invalid agent directory',
          });
          return true;
        }

        sendJsonResponse(res, 200, { id: agentId, ...agent });
      } catch {
        sendJsonResponse(res, 500, { error: 'Failed to update agent' });
      }
      return true;
    }

    if (req.method === 'DELETE') {
      await deleteAgent(agentId);
      sendJsonResponse(res, 200, { success: true });
      return true;
    }
  }

  return false;
}

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
      const messages = await getMessages(chatId);
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
    const chatFile = path.join(chatsDir, chatId, 'chat.jsonl');

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
