import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadAttachment, resetAuthClient } from './utils.js';
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
    resetAuthClient();
  });

  it('should successfully download an attachment within the size limit', async () => {
    const mockRequest = vi.fn().mockResolvedValue({
      data: new ArrayBuffer(1024), // 1 KB
    });

    // @ts-expect-error Mocking the client
    vi.mocked(google.auth.getClient).mockResolvedValue({
      request: mockRequest,
    });

    const buffer = await downloadAttachment('spaces/123/messages/456/attachments/789');

    expect(google.auth.getClient).toHaveBeenCalledWith({
      scopes: ['https://www.googleapis.com/auth/chat.bot'],
    });
    expect(mockRequest).toHaveBeenCalledWith({
      url: 'https://chat.googleapis.com/v1/media/spaces/123/messages/456/attachments/789?alt=media',
      method: 'GET',
      responseType: 'arraybuffer',
    });
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(1024);
  });

  it('should throw an error if the attachment exceeds the maximum size', async () => {
    const maxSizeBytes = 25 * 1024 * 1024;
    const mockRequest = vi.fn().mockResolvedValue({
      data: new ArrayBuffer(maxSizeBytes + 1),
    });

    // @ts-expect-error Mocking the client
    vi.mocked(google.auth.getClient).mockResolvedValue({
      request: mockRequest,
    });

    await expect(downloadAttachment('spaces/123/messages/456/attachments/789')).rejects.toThrow(
      'Attachment exceeds maximum size'
    );
  });

  it('should throw an error if the attachment exceeds a custom maximum size', async () => {
    const maxSizeBytes = 10 * 1024 * 1024;
    const mockRequest = vi.fn().mockResolvedValue({
      data: new ArrayBuffer(maxSizeBytes + 1),
    });

    // @ts-expect-error Mocking the client
    vi.mocked(google.auth.getClient).mockResolvedValue({
      request: mockRequest,
    });

    await expect(downloadAttachment('spaces/123/messages/456/attachments/789', 10)).rejects.toThrow(
      'Attachment exceeds maximum size'
    );
  });
});
