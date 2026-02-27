import { Command } from 'commander';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listChats, getMessages, getChatsDir, createChat } from '../../shared/chats.js';
import { getDaemonClient } from '../client.js';
import {
  listAgents,
  getAgent,
  writeAgentSettings,
  writeChatSettings,
  deleteAgent,
  isValidAgentId,
  resolveAgentDirectory,
} from '../../shared/workspace.js';

const mimeTypes: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export const webCmd = new Command('web')
  .description('Start the local clawmini web interface')
  .option('-p, --port <number>', 'Port to bind the server to', '8080')
  .action((options) => {
    const port = parseInt(options.port, 10);
    if (isNaN(port)) {
      console.error('Invalid port number.');
      process.exit(1);
    }

    // When bundled into dist/cli/index.mjs, import.meta.url resolves to that file.
    // So __dirname will be dist/cli, and webDir will be dist/web.
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const webDir = path.resolve(__dirname, '../web');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function parseJsonBody(req: http.IncomingMessage): Promise<any> {
      let bodyStr = '';
      for await (const chunk of req) {
        bodyStr += chunk;
      }
      return JSON.parse(bodyStr);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function sendJsonResponse(res: http.ServerResponse, statusCode: number, data: any) {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    }

    const server = http.createServer(async (req, res) => {
      try {
        const urlPath = req.url === '/' ? '/index.html' : req.url?.split('?')[0] || '/';

        // API Routes
        if (urlPath.startsWith('/api/')) {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

          if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
          }

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
            return;
          }

          if (req.method === 'POST' && urlPath === '/api/agents') {
            try {
              const body = await parseJsonBody(req);
              if (!body.id || !isValidAgentId(body.id)) {
                sendJsonResponse(res, 400, { error: 'Invalid or missing agent ID' });
                return;
              }
              const existing = await getAgent(body.id);
              if (existing) {
                sendJsonResponse(res, 409, { error: 'Agent already exists' });
                return;
              }

              let dirPath: string;
              try {
                dirPath = resolveAgentDirectory(body.id, body.directory);
              } catch (err) {
                sendJsonResponse(res, 400, {
                  error: err instanceof Error ? err.message : 'Invalid agent directory',
                });
                return;
              }

              if (!fs.existsSync(dirPath)) {
                await fs.promises.mkdir(dirPath, { recursive: true });
              }

              const newAgent = {
                directory: body.directory,
                env: body.env || {},
                commands: body.commands || {},
              };
              await writeAgentSettings(body.id, newAgent);

              sendJsonResponse(res, 201, { id: body.id, ...newAgent });
            } catch {
              sendJsonResponse(res, 500, { error: 'Failed to create agent' });
            }
            return;
          }

          const agentMatch = urlPath.match(/^\/api\/agents\/([^/]+)$/);
          if (agentMatch && agentMatch[1]) {
            const agentId = agentMatch[1];

            if (!isValidAgentId(agentId)) {
              sendJsonResponse(res, 400, { error: 'Invalid agent ID' });
              return;
            }

            if (req.method === 'GET') {
              const agent = await getAgent(agentId);
              if (!agent) {
                sendJsonResponse(res, 404, { error: 'Agent not found' });
                return;
              }
              sendJsonResponse(res, 200, { id: agentId, ...agent });
              return;
            }

            if (req.method === 'PUT' || req.method === 'POST') {
              try {
                const body = await parseJsonBody(req);
                const agent = (await getAgent(agentId)) || { env: {}, commands: {} };
                if (body.directory !== undefined) agent.directory = body.directory;
                if (body.env !== undefined) agent.env = body.env;
                if (body.commands !== undefined) agent.commands = body.commands;

                let dirPath: string;
                try {
                  dirPath = resolveAgentDirectory(agentId, agent.directory);
                } catch (err) {
                  sendJsonResponse(res, 400, {
                    error: err instanceof Error ? err.message : 'Invalid agent directory',
                  });
                  return;
                }

                if (!fs.existsSync(dirPath)) {
                  await fs.promises.mkdir(dirPath, { recursive: true });
                }

                await writeAgentSettings(agentId, agent);
                sendJsonResponse(res, 200, { id: agentId, ...agent });
              } catch {
                sendJsonResponse(res, 500, { error: 'Failed to update agent' });
              }
              return;
            }

            if (req.method === 'DELETE') {
              await deleteAgent(agentId);
              sendJsonResponse(res, 200, { success: true });
              return;
            }
          }

          if (req.method === 'GET' && urlPath === '/api/chats') {
            const chats = await listChats();
            sendJsonResponse(res, 200, chats);
            return;
          }

          if (req.method === 'POST' && urlPath === '/api/chats') {
            try {
              const body = await parseJsonBody(req);
              if (!body.id || typeof body.id !== 'string' || /\s/.test(body.id)) {
                sendJsonResponse(res, 400, {
                  error: 'Invalid chat ID. Must not contain whitespace.',
                });
                return;
              }
              await createChat(body.id);
              if (body.agent && typeof body.agent === 'string') {
                await writeChatSettings(body.id, { defaultAgent: body.agent });
              }
              sendJsonResponse(res, 201, { id: body.id, agent: body.agent });
            } catch {
              sendJsonResponse(res, 500, { error: 'Failed to create chat' });
            }
            return;
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
            return;
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
            return;
          }

          const messageMatch = urlPath.match(/^\/api\/chats\/([^/]+)\/messages$/);
          if (req.method === 'POST' && messageMatch && messageMatch[1]) {
            const chatId = messageMatch[1];

            let body;
            try {
              body = await parseJsonBody(req);
            } catch {
              sendJsonResponse(res, 400, { error: 'Invalid JSON body' });
              return;
            }

            if (!body.message || typeof body.message !== 'string') {
              sendJsonResponse(res, 400, { error: 'Missing or invalid "message" field' });
              return;
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
            return;
          }

          sendJsonResponse(res, 404, { error: 'Not Found' });
          return;
        }

        // Static Files
        let filePath = path.join(webDir, urlPath);

        // Prevent directory traversal
        const webDirWithSep = webDir.endsWith(path.sep) ? webDir : webDir + path.sep;
        if (!filePath.startsWith(webDirWithSep) && filePath !== webDir) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          // SPA fallback to index.html
          filePath = path.join(webDir, 'index.html');
          if (!fs.existsSync(filePath)) {
            res.writeHead(404);
            res.end('Not Found');
            return;
          }
        }

        const extname = path.extname(filePath).toLowerCase();
        const contentType = mimeTypes[extname] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        const readStream = fs.createReadStream(filePath);
        readStream.pipe(res);
      } catch (err) {
        console.error('Error serving request:', err);
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    });

    server.listen(port, '127.0.0.1', () => {
      console.log(`Clawmini web interface running at http://127.0.0.1:${port}/`);
    });
  });
