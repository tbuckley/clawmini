import { google } from 'googleapis';

export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25 MB

/**
 * Downloads a file attachment securely using Application Default Credentials (ADC).
 * @param downloadUri The URI of the attachment to download.
 * @returns A Buffer containing the file data.
 */
export async function downloadAttachment(downloadUri: string): Promise<Buffer> {
  // Use ADC to authenticate
  const client = await google.auth.getClient({
    scopes: ['https://www.googleapis.com/auth/chat.bot'],
  });

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
