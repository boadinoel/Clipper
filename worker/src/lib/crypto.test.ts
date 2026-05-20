import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken } from './crypto.js';

describe('crypto', () => {
  it('round-trips a token', () => {
    const plain = 'hello-world-' + Math.random().toString(36).slice(2);
    const enc = encryptToken(plain);
    expect(enc).not.toContain(plain);
    expect(decryptToken(enc)).toBe(plain);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const a = encryptToken('same');
    const b = encryptToken('same');
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe('same');
    expect(decryptToken(b)).toBe('same');
  });

  it('rejects tampered ciphertext', () => {
    const enc = encryptToken('immutable');
    const decoded = Buffer.from(enc, 'base64');
    const last = decoded.length - 1;
    decoded.writeUInt8(decoded.readUInt8(last) ^ 0x01, last);
    const tampered = decoded.toString('base64');
    expect(() => decryptToken(tampered)).toThrow();
  });

  it('rejects short payloads', () => {
    expect(() => decryptToken('AAAA')).toThrow();
  });
});
