import { describe, it, expect } from 'vitest';
import { resolveEnabledServices } from './serve.js';

describe('resolveEnabledServices', () => {
  it('defaults to daemon + web when no adapter configs are present', () => {
    const result = resolveEnabledServices({
      adapterConfigPresent: { 'adapter-discord': false, 'adapter-google-chat': false },
    });
    expect(result).toEqual(['daemon', 'web']);
  });

  it('includes discord when its config file is present', () => {
    const result = resolveEnabledServices({
      adapterConfigPresent: { 'adapter-discord': true, 'adapter-google-chat': false },
    });
    expect(result).toEqual(['daemon', 'web', 'adapter-discord']);
  });

  it('includes both adapters when both configs are present', () => {
    const result = resolveEnabledServices({
      adapterConfigPresent: { 'adapter-discord': true, 'adapter-google-chat': true },
    });
    expect(result).toEqual(['daemon', 'web', 'adapter-discord', 'adapter-google-chat']);
  });

  it('honors --only as an explicit subset', () => {
    const result = resolveEnabledServices({
      only: 'daemon,web',
      adapterConfigPresent: { 'adapter-discord': true, 'adapter-google-chat': true },
    });
    expect(result).toEqual(['daemon', 'web']);
  });

  it('resolves adapter short names in --only', () => {
    const result = resolveEnabledServices({
      only: 'discord,google-chat',
      adapterConfigPresent: { 'adapter-discord': false, 'adapter-google-chat': false },
    });
    expect(result).toEqual(['adapter-discord', 'adapter-google-chat']);
  });

  it('filters via --exclude when no --only is given', () => {
    const result = resolveEnabledServices({
      exclude: 'web,discord',
      adapterConfigPresent: { 'adapter-discord': true, 'adapter-google-chat': true },
    });
    expect(result).toEqual(['daemon', 'adapter-google-chat']);
  });

  it('applies --exclude on top of --only', () => {
    const result = resolveEnabledServices({
      only: 'daemon,web,discord',
      exclude: 'discord',
      adapterConfigPresent: { 'adapter-discord': true, 'adapter-google-chat': false },
    });
    expect(result).toEqual(['daemon', 'web']);
  });

  it('throws on unknown service name', () => {
    expect(() =>
      resolveEnabledServices({
        only: 'nope',
        adapterConfigPresent: { 'adapter-discord': false, 'adapter-google-chat': false },
      })
    ).toThrow(/Unknown service/);
  });
});
