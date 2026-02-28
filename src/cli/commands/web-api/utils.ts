import http from 'node:http';
import { type ZodType } from 'zod';

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
