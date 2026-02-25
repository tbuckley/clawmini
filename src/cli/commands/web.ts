import { Command } from 'commander';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listChats, getMessages } from '../../shared/chats.js';
import { getDaemonClient } from '../client.js';

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

          if (req.method === 'GET' && urlPath === '/api/chats') {
            const chats = await listChats();
            res.writeHead(200);
            res.end(JSON.stringify(chats));
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
