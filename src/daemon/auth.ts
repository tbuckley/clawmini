import crypto from 'node:crypto';
import type { Settings } from '../shared/config.js';

// In-memory secret generated on daemon startup.
// Valid tokens will only last for the lifetime of the daemon process.
const DAEMON_SECRET = crypto.randomBytes(32);

export interface TokenPayload {
  chatId: string;
  agentId: string;
  sessionId: string;
  subagentId?: string;
  timestamp: number;
}

export function generateToken(payload: TokenPayload): string {
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64');
  const hmac = crypto.createHmac('sha256', DAEMON_SECRET).update(payloadStr).digest('hex');
  return `${payloadStr}.${hmac}`;
}

export function validateToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [payloadStr, signature] = parts;
    if (!payloadStr || !signature) return null;

    const expectedHmac = crypto
      .createHmac('sha256', DAEMON_SECRET)
      .update(payloadStr)
      .digest('hex');

    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedHmacBuffer = Buffer.from(expectedHmac, 'hex');

    if (
      signatureBuffer.length !== expectedHmacBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedHmacBuffer)
    ) {
      return null;
    }

    const payloadJson = Buffer.from(payloadStr, 'base64').toString('utf8');
    return JSON.parse(payloadJson) as TokenPayload;
  } catch {
    return null;
  }
}

export function getApiContext(settings?: Settings) {
  if (settings?.api === undefined) return null;
  let isApiEnabled = false;
  let apiHost = '127.0.0.1';
  let apiPort = 3000;
  let proxyHost: string | undefined = undefined;

  if (typeof settings.api === 'boolean') {
    isApiEnabled = settings.api;
  } else if (typeof settings.api === 'object') {
    isApiEnabled = true;
    apiHost = settings.api.host ?? '127.0.0.1';
    apiPort = settings.api.port ?? 3000;
    proxyHost = settings.api.proxy_host;
  }

  if (!isApiEnabled) return null;
  return { host: apiHost, port: apiPort, proxy_host: proxyHost };
}
