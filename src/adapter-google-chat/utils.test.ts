import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadAttachment, MAX_ATTACHMENT_SIZE } from './utils.js';
import { google } from 'googleapis';

vi.mock('googleapis', () => {
  return {
    google: {
      auth: {
        getClient: vi.fn(),
      },
    },
  };
});

describe('downloadAttachment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should successfully download an attachment within the size limit', async () => {
    const mockRequest = vi.fn().mockResolvedValue({
      data: new ArrayBuffer(1024), // 1 KB
    });

    // @ts-expect-error Mocking the client
    vi.mocked(google.auth.getClient).mockResolvedValue({
      request: mockRequest,
    });

    const buffer = await downloadAttachment('https://example.com/download');

    expect(google.auth.getClient).toHaveBeenCalledWith({
      scopes: ['https://www.googleapis.com/auth/chat.bot'],
    });
    expect(mockRequest).toHaveBeenCalledWith({
      url: 'https://example.com/download',
      method: 'GET',
      responseType: 'arraybuffer',
    });
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(1024);
  });

  it('should throw an error if the attachment exceeds the maximum size', async () => {
    const mockRequest = vi.fn().mockResolvedValue({
      data: new ArrayBuffer(MAX_ATTACHMENT_SIZE + 1),
    });

    // @ts-expect-error Mocking the client
    vi.mocked(google.auth.getClient).mockResolvedValue({
      request: mockRequest,
    });

    await expect(downloadAttachment('https://example.com/download-large')).rejects.toThrow(
      'Attachment exceeds maximum size'
    );
  });
});
