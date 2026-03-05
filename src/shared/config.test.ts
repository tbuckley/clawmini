import { describe, it, expect } from 'vitest';
import { SettingsSchema, AgentSchema } from './config.js';

describe('SettingsSchema', () => {
  it('should parse empty settings', () => {
    const result = SettingsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.api).toBeUndefined();
    }
  });

  it('should parse api: false', () => {
    const result = SettingsSchema.safeParse({ api: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.api).toBe(false);
    }
  });

  it('should parse api: true', () => {
    const result = SettingsSchema.safeParse({ api: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.api).toBe(true);
    }
  });

  it('should parse api: { host: string, port: number }', () => {
    const result = SettingsSchema.safeParse({ api: { host: '127.0.0.1', port: 3000 } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.api).toEqual({ host: '127.0.0.1', port: 3000 });
    }
  });

  it('should fail if api has wrong type', () => {
    const result = SettingsSchema.safeParse({ api: 'yes' });
    expect(result.success).toBe(false);
  });

  it('should parse api object missing port', () => {
    const result = SettingsSchema.safeParse({ api: { host: '127.0.0.1' } });
    expect(result.success).toBe(true);
  });

  it('should parse api object missing host', () => {
    const result = SettingsSchema.safeParse({ api: { port: 3000 } });
    expect(result.success).toBe(true);
  });

  it('should parse api object with proxy_host', () => {
    const result = SettingsSchema.safeParse({ api: { proxy_host: 'http://my-proxy' } });
    expect(result.success).toBe(true);
  });

  it('should parse files property with default', () => {
    const result = SettingsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.files).toBe('./attachments');
    }
  });

  it('should parse custom files property', () => {
    const result = SettingsSchema.safeParse({ files: './my-files' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.files).toBe('./my-files');
    }
  });
});

describe('AgentSchema', () => {
  it('should parse files property with default', () => {
    const result = AgentSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.files).toBe('./attachments');
    }
  });

  it('should parse custom files property', () => {
    const result = AgentSchema.safeParse({ files: './my-files' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.files).toBe('./my-files');
    }
  });
});
