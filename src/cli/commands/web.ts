import { Command } from 'commander';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pathIsInsideDir } from '../../shared/utils/fs.js';
import { handleApiAgents, handleApiChats, sendJsonResponse } from './web-api.js';

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

          if (urlPath.startsWith('/api/agents') && (await handleApiAgents(req, res, urlPath)))
            return;
          if (urlPath.startsWith('/api/chats') && (await handleApiChats(req, res, urlPath))) return;

          sendJsonResponse(res, 404, { error: 'Not Found' });
          return;
        }

        // Static Files
        let filePath = path.join(webDir, urlPath);

        // Prevent directory traversal
        if (!pathIsInsideDir(filePath, webDir)) {
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
