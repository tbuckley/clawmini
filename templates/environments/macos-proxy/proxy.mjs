import http from 'http';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// eslint-disable-next-line no-undef
const envDir = process.env.ENV_DIR || __dirname;
const allowlistPath = path.join(envDir, 'allowlist.txt');

function isAllowed(hostname) {
  try {
    if (!fs.existsSync(allowlistPath)) {
      return hostname === 'generativelanguage.googleapis.com';
    }
    const content = fs.readFileSync(allowlistPath, 'utf8');
    const allowedDomains = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    return allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch (err) {
    console.error('Error reading allowlist:', err);
    return false;
  }
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url);
    if (!isAllowed(url.hostname)) {
      console.log(`[${new Date().toISOString()}] [HTTP] Blocked: ${url.hostname}`);
      res.writeHead(403);
      res.end('Domain not allowed by proxy allowlist\n');
      return;
    }
    // console.log(`[HTTP] Allowed: ${url.hostname}`);

    const proxyReq = http.request(
      url,
      {
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      }
    );
    req.pipe(proxyReq, { end: true });
    proxyReq.on('error', (err) => {
      res.writeHead(500);
      res.end(err.message);
    });
  } catch {
    res.writeHead(400);
    res.end('Bad request');
  }
});

server.on('connect', (req, clientSocket, head) => {
  try {
    const { port, hostname } = new URL(`http://${req.url}`);
    if (!isAllowed(hostname)) {
      // Log the domain and timestamp
      console.log(`[${new Date().toISOString()}] [HTTPS] Blocked: ${hostname}`);
      clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\nDomain not allowed by proxy allowlist\n');
      clientSocket.end();
      return;
    }
    // Only log blocked domains for now
    // console.log(`[HTTPS] Allowed: ${hostname}`);

    const serverSocket = net.connect(port || 443, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });
    serverSocket.on('error', () => clientSocket.end());
    clientSocket.on('error', () => serverSocket.end());
  } catch {
    clientSocket.end();
  }
});

server.listen(8888, () => {
  console.log('Proxy listening on port 8888');
});
