import { google } from 'googleapis';

export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25 MB

let authClient: Awaited<ReturnType<typeof google.auth.getClient>> | null = null;

export function resetAuthClient(): void {
  authClient = null;
}

/**
 * Downloads a file attachment securely using Application Default Credentials (ADC).
 * @param downloadUri The URI of the attachment to download.
 * @returns A Buffer containing the file data.
 */
export async function downloadAttachment(downloadUri: string): Promise<Buffer> {
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

  if (buffer.length > MAX_ATTACHMENT_SIZE) {
    throw new Error(
      `Attachment exceeds maximum size of ${MAX_ATTACHMENT_SIZE} bytes: ${buffer.length} bytes`
    );
  }

  return buffer;
}
