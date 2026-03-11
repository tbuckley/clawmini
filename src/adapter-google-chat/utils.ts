import { google } from 'googleapis';

let authClient: Awaited<ReturnType<typeof google.auth.getClient>> | null = null;

export function resetAuthClient(): void {
  authClient = null;
}

/**
 * Downloads a file attachment securely using Application Default Credentials (ADC).
 * @param downloadUri The URI of the attachment to download.
 * @param maxAttachmentSizeMB The maximum allowed attachment size in MB (defaults to 25).
 * @returns A Buffer containing the file data.
 */
export async function downloadAttachment(
  downloadUri: string,
  maxAttachmentSizeMB: number = 25
): Promise<Buffer> {
  // Use ADC to authenticate
  if (!authClient) {
    authClient = await google.auth.getClient({
      scopes: ['https://www.googleapis.com/auth/chat.bot'],
    });
  }
  const client = authClient;

  const response = await client.request<ArrayBuffer>({
    url: downloadUri,
    method: 'GET',
    responseType: 'arraybuffer',
  });

  const buffer = Buffer.from(response.data);

  const maxSizeBytes = maxAttachmentSizeMB * 1024 * 1024;
  if (buffer.length > maxSizeBytes) {
    throw new Error(
      `Attachment exceeds maximum size of ${maxSizeBytes} bytes: ${buffer.length} bytes`
    );
  }

  return buffer;
}
