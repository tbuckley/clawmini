import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadAttachment, resetAuthClient } from './utils.js';
import { google } from 'googleapis';
import { EventEmitter } from 'node:events';

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
    const mockStream = new EventEmitter();
    // @ts-expect-error Mocking the stream destroy
    mockStream.destroy = vi.fn();

    const mockRequest = vi.fn().mockResolvedValue({
      data: mockStream,
    });

    // @ts-expect-error Mocking the client
    vi.mocked(google.auth.getClient).mockResolvedValue({
      request: mockRequest,
    });

    const promise = downloadAttachment('spaces/123/messages/456/attachments/789');

    await new Promise(setImmediate);

    // Simulate stream data and end
    mockStream.emit('data', Buffer.alloc(1024));
    mockStream.emit('end');

    const buffer = await promise;

    expect(google.auth.getClient).toHaveBeenCalledWith({
      scopes: ['https://www.googleapis.com/auth/chat.bot'],
    });
    expect(mockRequest).toHaveBeenCalledWith({
      url: 'https://chat.googleapis.com/v1/media/spaces/123/messages/456/attachments/789?alt=media',
      method: 'GET',
      responseType: 'stream',
    });
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(1024);
  });

  it('should throw an error if the attachment exceeds the maximum size', async () => {
    const maxSizeBytes = 25 * 1024 * 1024;
    const mockStream = new EventEmitter();
    // @ts-expect-error Mocking the stream destroy
    mockStream.destroy = vi.fn();

    const mockRequest = vi.fn().mockResolvedValue({
      data: mockStream,
    });

    // @ts-expect-error Mocking the client
    vi.mocked(google.auth.getClient).mockResolvedValue({
      request: mockRequest,
    });

    const promise = downloadAttachment('spaces/123/messages/456/attachments/789');

    await new Promise(setImmediate);

    // Simulate stream data exceeding the limit
    mockStream.emit('data', Buffer.alloc(maxSizeBytes + 1));

    await expect(promise).rejects.toThrow('Attachment exceeds maximum size');
    // @ts-expect-error Mocking the stream destroy
    expect(mockStream.destroy).toHaveBeenCalled();
  });

  it('should throw an error if the attachment exceeds a custom maximum size', async () => {
    const maxSizeBytes = 10 * 1024 * 1024;
    const mockStream = new EventEmitter();
    // @ts-expect-error Mocking the stream destroy
    mockStream.destroy = vi.fn();

    const mockRequest = vi.fn().mockResolvedValue({
      data: mockStream,
    });

    // @ts-expect-error Mocking the client
    vi.mocked(google.auth.getClient).mockResolvedValue({
      request: mockRequest,
    });

    const promise = downloadAttachment('spaces/123/messages/456/attachments/789', 10);

    await new Promise(setImmediate);

    // Simulate stream data exceeding the limit
    mockStream.emit('data', Buffer.alloc(maxSizeBytes + 1));

    await expect(promise).rejects.toThrow('Attachment exceeds maximum size');
    // @ts-expect-error Mocking the stream destroy
    expect(mockStream.destroy).toHaveBeenCalled();
  });
});
