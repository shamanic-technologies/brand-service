import { describe, it, expect, vi } from 'vitest';

// whatsAppLinkService imports ../db (throws at import without a DB url).
// normalizeWhatsAppLink is pure — stub the db module (CI test:unit has no DB).
vi.mock('../../src/db', () => ({
  db: {},
  brandWhatsappLinks: {},
}));

import {
  normalizeWhatsAppLink,
  WhatsAppLinkValidationError,
} from '../../src/services/whatsAppLinkService';

describe('normalizeWhatsAppLink', () => {
  it('accepts a wa.me URL as-is', () => {
    expect(normalizeWhatsAppLink('https://wa.me/15551234567')).toBe(
      'https://wa.me/15551234567'
    );
  });

  it('accepts an api.whatsapp.com URL', () => {
    expect(
      normalizeWhatsAppLink('https://api.whatsapp.com/send?phone=15551234567')
    ).toBe('https://api.whatsapp.com/send?phone=15551234567');
  });

  it('accepts a chat.whatsapp.com group link', () => {
    expect(normalizeWhatsAppLink('https://chat.whatsapp.com/AbCdEf123')).toBe(
      'https://chat.whatsapp.com/AbCdEf123'
    );
  });

  it('accepts a www-prefixed whatsapp host', () => {
    expect(normalizeWhatsAppLink('https://www.whatsapp.com/x')).toBe(
      'https://www.whatsapp.com/x'
    );
  });

  it('normalizes a bare international number (with +) to a wa.me link', () => {
    expect(normalizeWhatsAppLink('+1 (555) 123-4567')).toBe('https://wa.me/15551234567');
  });

  it('normalizes a plain digit string to a wa.me link', () => {
    expect(normalizeWhatsAppLink('15551234567')).toBe('https://wa.me/15551234567');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeWhatsAppLink('  https://wa.me/33612345678  ')).toBe(
      'https://wa.me/33612345678'
    );
  });

  it('rejects an http (non-https) whatsapp URL', () => {
    expect(() => normalizeWhatsAppLink('http://wa.me/15551234567')).toThrow(
      WhatsAppLinkValidationError
    );
  });

  it('rejects a non-WhatsApp host', () => {
    expect(() => normalizeWhatsAppLink('https://example.com/chat')).toThrow(
      WhatsAppLinkValidationError
    );
  });

  it('rejects an unparseable string', () => {
    expect(() => normalizeWhatsAppLink('not a link')).toThrow(WhatsAppLinkValidationError);
  });

  it('rejects an empty string', () => {
    expect(() => normalizeWhatsAppLink('   ')).toThrow(WhatsAppLinkValidationError);
  });

  it('rejects a non-string', () => {
    expect(() => normalizeWhatsAppLink(12345 as unknown)).toThrow(WhatsAppLinkValidationError);
  });

  it('rejects a too-short number', () => {
    expect(() => normalizeWhatsAppLink('12345')).toThrow(WhatsAppLinkValidationError);
  });

  it('rejects a too-long number', () => {
    expect(() => normalizeWhatsAppLink('1234567890123456')).toThrow(
      WhatsAppLinkValidationError
    );
  });
});
