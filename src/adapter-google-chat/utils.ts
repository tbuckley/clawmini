import { google } from 'googleapis';
import type { Readable } from 'node:stream';

let authClient: Awaited<ReturnType<typeof google.auth.getClient>> | null = null;

export function resetAuthClient(): void {
  authClient = null;
}

/**
 * Downloads a file attachment securely using Application Default Credentials (ADC).
 * @param resourceName The resourceName of the attachment data to download.
 * @param maxAttachmentSizeMB The maximum allowed attachment size in MB (defaults to 25).
 * @returns A Buffer containing the file data.
 */
export async function downloadAttachment(
  resourceName: string,
  maxAttachmentSizeMB: number = 25
): Promise<Buffer> {
  // Use ADC to authenticate
  if (!authClient) {
    authClient = await google.auth.getClient({
      scopes: ['https://www.googleapis.com/auth/chat.bot'],
    });
  }
  const client = authClient;

  const url = `https://chat.googleapis.com/v1/media/${resourceName}?alt=media`;

  const response = await client.request<Readable>({
    url,
    method: 'GET',
    responseType: 'stream',
  });

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const maxSizeBytes = maxAttachmentSizeMB * 1024 * 1024;

    response.data.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxSizeBytes) {
        response.data.destroy();
        reject(
          new Error(`Attachment exceeds maximum size of ${maxSizeBytes} bytes: ${totalBytes} bytes`)
        );
      } else {
        chunks.push(chunk);
      }
    });

    response.data.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    response.data.on('error', (err: Error) => {
      reject(err);
    });
  });
}
