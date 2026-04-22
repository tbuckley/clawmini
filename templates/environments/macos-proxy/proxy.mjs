import http from 'http';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  req.on('error', (err) => console.error('[HTTP] Client request error:', err.message));
  res.on('error', (err) => console.error('[HTTP] Client response error:', err.message));

  try {
    const url = new URL(req.url);
    if (!isAllowed(url.hostname)) {
      console.log(`[HTTP] Blocked: ${url.hostname}`);
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
        proxyRes.on('error', (err) => console.error('[HTTP] Proxy response error:', err.message));
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      }
    );

    proxyReq.on('error', (err) => {
      console.error('[HTTP] Proxy request error:', err.message);
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end(err.message);
    });

    req.pipe(proxyReq, { end: true });
  } catch (err) {
    console.error('[HTTP] Error handling request:', err.message);
    if (!res.headersSent) {
      res.writeHead(400);
    }
    res.end('Bad request');
  }
});

server.on('connect', (req, clientSocket, head) => {
  clientSocket.on('error', (err) => {
    console.error(`[HTTPS] Client socket error:`, err.message);
    clientSocket.destroy();
  });

  try {
    const { port, hostname } = new URL(`http://${req.url}`);
    if (!isAllowed(hostname)) {
      console.log(`[HTTPS] Blocked: ${hostname}`);
      clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\nDomain not allowed by proxy allowlist\n');
      clientSocket.end();
      return;
    }
    // console.log(`[HTTPS] Allowed: ${hostname}`);

    const serverSocket = net.connect(port || 443, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', (err) => {
      console.error(`[HTTPS] Server socket error for ${hostname}:`, err.message);
      clientSocket.destroy();
    });

    // Update client error handler to also destroy serverSocket if it exists
    clientSocket.removeAllListeners('error');
    clientSocket.on('error', (err) => {
      console.error(`[HTTPS] Client socket error for ${hostname}:`, err.message);
      serverSocket.destroy();
    });
  } catch (err) {
    console.error(`[HTTPS] Connection error:`, err.message);
    clientSocket.destroy();
  }
});

server.on('error', (err) => {
  console.error('Proxy server error:', err);
});

server.listen(8888, () => {
  console.log('Proxy listening on port 8888');
});
