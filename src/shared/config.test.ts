import { describe, it, expect } from 'vitest';
import { SettingsSchema } from './config.js';

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

  it('should fail if api object is missing port', () => {
    const result = SettingsSchema.safeParse({ api: { host: '127.0.0.1' } });
    expect(result.success).toBe(false);
  });
});
