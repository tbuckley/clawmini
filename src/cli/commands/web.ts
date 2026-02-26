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
            res.writeHead(200);
            res.end(JSON.stringify(agents));
            return;
          }

          if (req.method === 'POST' && urlPath === '/api/agents') {
            let bodyStr = '';
            for await (const chunk of req) {
              bodyStr += chunk;
            }
            try {
              const body = JSON.parse(bodyStr);
              if (!body.id || !isValidAgentId(body.id)) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid or missing agent ID' }));
                return;
              }
              const existing = await getAgent(body.id);
              if (existing) {
                res.writeHead(409);
                res.end(JSON.stringify({ error: 'Agent already exists' }));
                return;
              }
              const newAgent = {
                directory: body.directory,
                env: body.env || {},
                commands: body.commands || {},
              };
              await writeAgentSettings(body.id, newAgent);
              res.writeHead(201);
              res.end(JSON.stringify({ id: body.id, ...newAgent }));
            } catch {
              res.writeHead(500);
              res.end(JSON.stringify({ error: 'Failed to create agent' }));
            }
            return;
          }

          const agentMatch = urlPath.match(/^\/api\/agents\/([^/]+)$/);
          if (agentMatch && agentMatch[1]) {
            const agentId = agentMatch[1];

            if (!isValidAgentId(agentId)) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'Invalid agent ID' }));
              return;
            }

            if (req.method === 'GET') {
              const agent = await getAgent(agentId);
              if (!agent) {
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Agent not found' }));
                return;
              }
              res.writeHead(200);
              res.end(JSON.stringify({ id: agentId, ...agent }));
              return;
            }

            if (req.method === 'PUT' || req.method === 'POST') {
              let bodyStr = '';
              for await (const chunk of req) {
                bodyStr += chunk;
              }
              try {
                const body = JSON.parse(bodyStr);
                const agent = (await getAgent(agentId)) || { env: {}, commands: {} };
                if (body.directory !== undefined) agent.directory = body.directory;
                if (body.env !== undefined) agent.env = body.env;
                if (body.commands !== undefined) agent.commands = body.commands;

                await writeAgentSettings(agentId, agent);
                res.writeHead(200);
                res.end(JSON.stringify({ id: agentId, ...agent }));
              } catch {
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Failed to update agent' }));
              }
              return;
            }

            if (req.method === 'DELETE') {
              await deleteAgent(agentId);
              res.writeHead(200);
              res.end(JSON.stringify({ success: true }));
              return;
            }
          }

          if (req.method === 'GET' && urlPath === '/api/chats') {
            const chats = await listChats();
            res.writeHead(200);
            res.end(JSON.stringify(chats));
            return;
          }

          if (req.method === 'POST' && urlPath === '/api/chats') {
            let bodyStr = '';
            for await (const chunk of req) {
              bodyStr += chunk;
            }
            try {
              const body = JSON.parse(bodyStr);
              if (!body.id || typeof body.id !== 'string' || /\s/.test(body.id)) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid chat ID. Must not contain whitespace.' }));
                return;
              }
              await createChat(body.id);
              if (body.agent && typeof body.agent === 'string') {
                await writeChatSettings(body.id, { agent: body.agent });
              }
              res.writeHead(201);
              res.end(JSON.stringify({ id: body.id, agent: body.agent }));
            } catch {
              res.writeHead(500);
              res.end(JSON.stringify({ error: 'Failed to create chat' }));
            }
            return;
          }

          const chatMatch = urlPath.match(/^\/api\/chats\/([^/]+)$/);
          if (req.method === 'GET' && chatMatch && chatMatch[1]) {
            const chatId = chatMatch[1];
            try {
              const messages = await getMessages(chatId);
              res.writeHead(200);
              res.end(JSON.stringify(messages));
            } catch {
              res.writeHead(404);
              res.end(JSON.stringify({ error: 'Chat not found' }));
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
            let bodyStr = '';
            for await (const chunk of req) {
              bodyStr += chunk;
            }

            let body;
            try {
              body = JSON.parse(bodyStr);
            } catch {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'Invalid JSON body' }));
              return;
            }

            if (!body.message || typeof body.message !== 'string') {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'Missing or invalid "message" field' }));
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
              res.writeHead(200);
              res.end(JSON.stringify({ success: true }));
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : 'Unknown error';
              res.writeHead(500);
              res.end(JSON.stringify({ error: errorMessage || 'Internal Server Error' }));
            }
            return;
          }

          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Not Found' }));
          return;
        }

        // Static Files
        let filePath = path.join(webDir, urlPath);

        // Prevent directory traversal
        if (!filePath.startsWith(webDir)) {
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
