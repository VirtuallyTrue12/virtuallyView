import { describe, test, expect, afterEach } from 'vitest';
import { openSecret, sealSecret, secretsEnabled } from '../../apps/server/src/lib/secrets.js';

afterEach(() => { delete process.env.VV_SECRET_KEY; });

describe('optional encryption of stored secrets', () => {
  test('with no key nothing changes: values are stored and read as they are', () => {
    expect(secretsEnabled()).toBe(false);
    expect(sealSecret('my-api-key')).toBe('my-api-key');
    expect(openSecret('my-api-key')).toBe('my-api-key');
  });

  test('with a key values are encrypted, differ each time, and read back', () => {
    process.env.VV_SECRET_KEY = 'a-long-random-secret-for-tests';
    const a = sealSecret('my-api-key'), b = sealSecret('my-api-key');
    expect(a).toMatch(/^enc:v1:/);
    expect(a).not.toContain('my-api-key');
    expect(a).not.toBe(b);
    expect(openSecret(a)).toBe('my-api-key');
    expect(sealSecret(a)).toBe(a);
    expect(sealSecret('')).toBe('');
  });

  test('older plain values still read once a key is set, and are sealed on the next save', () => {
    process.env.VV_SECRET_KEY = 'a-long-random-secret-for-tests';
    expect(openSecret('legacy-plain')).toBe('legacy-plain');
    expect(sealSecret('legacy-plain')).toMatch(/^enc:v1:/);
  });

  test('the wrong key, no key, or tampering gives an empty value, never garbage', () => {
    process.env.VV_SECRET_KEY = 'first-secret-first-secret-first';
    const sealed = sealSecret('my-api-key');
    process.env.VV_SECRET_KEY = 'other-secret-other-secret-other';
    expect(openSecret(sealed)).toBe('');
    delete process.env.VV_SECRET_KEY;
    expect(openSecret(sealed)).toBe('');
    process.env.VV_SECRET_KEY = 'first-secret-first-secret-first';
    expect(openSecret(sealed.slice(0, -4) + 'AAAA')).toBe('');
  });
});
