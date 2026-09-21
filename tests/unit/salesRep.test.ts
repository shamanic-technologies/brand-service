import { describe, it, expect, vi } from 'vitest';

// The service imports ../db, which throws at import time with no DB url (the
// unit suite runs without one).
vi.mock('../../src/db', () => ({ db: {}, brandSalesRepPhones: {} }));

import {
  assertSalesRepWritable,
  normalizeSalesRepEmail,
  normalizeSalesRepPhone,
  SalesRepEmailRequiredError,
  SalesRepEmailValidationError,
  SalesRepPhoneValidationError,
} from '../../src/services/salesRepService';

/**
 * The number is handed straight to a telephony provider, so a value that
 * reaches the dialler unusable is a call that never happens, silently. The
 * normalizer is what stops that: any typed format in, strict E.164 out, and a
 * loud 400 for anything that cannot be dialled internationally.
 */
describe('normalizeSalesRepPhone', () => {
  it('keeps an already-E.164 number as-is', () => {
    expect(normalizeSalesRepPhone('+33770657585')).toBe('+33770657585');
  });

  it('strips whatever separators a person typed', () => {
    expect(normalizeSalesRepPhone('+33 7 70 65 75 85')).toBe('+33770657585');
    expect(normalizeSalesRepPhone('+33-770-657-585')).toBe('+33770657585');
    expect(normalizeSalesRepPhone(' (+1) 555.987.6543 ')).toBe('+15559876543');
  });

  it('accepts the international 00 prefix as the country-code marker', () => {
    expect(normalizeSalesRepPhone('0033770657585')).toBe('+33770657585');
    expect(normalizeSalesRepPhone('00 33 770 657 585')).toBe('+33770657585');
  });

  // No inference: a national number could belong to any country, and a guess
  // dials a different person.
  it('rejects a national number with no country code rather than guessing one', () => {
    expect(() => normalizeSalesRepPhone('0770657585')).toThrow(SalesRepPhoneValidationError);
    expect(() => normalizeSalesRepPhone('770657585')).toThrow(SalesRepPhoneValidationError);
  });

  it('rejects a country code starting with 0', () => {
    expect(() => normalizeSalesRepPhone('+0770657585')).toThrow(SalesRepPhoneValidationError);
  });

  it('rejects letters, extensions and anything unparseable', () => {
    expect(() => normalizeSalesRepPhone('+3377065758x123')).toThrow(SalesRepPhoneValidationError);
    expect(() => normalizeSalesRepPhone('call me')).toThrow(SalesRepPhoneValidationError);
  });

  it('rejects too few and too many digits (E.164 allows 15)', () => {
    expect(() => normalizeSalesRepPhone('+1234567')).toThrow(SalesRepPhoneValidationError);
    expect(normalizeSalesRepPhone('+12345678')).toBe('+12345678');
    expect(normalizeSalesRepPhone('+123456789012345')).toBe('+123456789012345');
    expect(() => normalizeSalesRepPhone('+1234567890123456')).toThrow(SalesRepPhoneValidationError);
  });

  it('rejects a missing / empty / non-string value instead of storing an empty number', () => {
    expect(() => normalizeSalesRepPhone(undefined)).toThrow(SalesRepPhoneValidationError);
    expect(() => normalizeSalesRepPhone('')).toThrow(SalesRepPhoneValidationError);
    expect(() => normalizeSalesRepPhone('   ')).toThrow(SalesRepPhoneValidationError);
    expect(() => normalizeSalesRepPhone(33770657585)).toThrow(SalesRepPhoneValidationError);
  });
});

describe('normalizeSalesRepEmail', () => {
  it('trims and otherwise stores the address exactly as typed', () => {
    expect(normalizeSalesRepEmail('  kevin@acme.com  ')).toBe('kevin@acme.com');
  });

  it('preserves case — the address belongs to the person who typed it', () => {
    expect(normalizeSalesRepEmail('Kevin.Lourd@Acme.co.uk')).toBe('Kevin.Lourd@Acme.co.uk');
  });

  it('accepts the ordinary shapes a person types', () => {
    for (const email of [
      'kevin@acme.com',
      'kevin.lourd@acme.co.uk',
      'kevin+sales@acme.com',
      'kevin_l@sub.acme.io',
      "o'brien@acme.com",
    ]) {
      expect(normalizeSalesRepEmail(email)).toBe(email);
    }
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['not a string', 42],
    ['null', null],
    ['undefined', undefined],
    ['no at sign', 'kevin.acme.com'],
    ['two at signs', 'kevin@@acme.com'],
    ['at sign at the end', 'kevin@'],
    ['at sign at the start', '@acme.com'],
    ['no dot in the domain', 'kevin@acme'],
    ['trailing dot in the domain', 'kevin@acme.com.'],
    ['empty domain label', 'kevin@acme..com'],
    ['a space inside', 'kevin @acme.com'],
    ['a tab inside', 'kevin\t@acme.com'],
  ])('refuses an unusable address (%s)', (_label, input) => {
    expect(() => normalizeSalesRepEmail(input)).toThrow(SalesRepEmailValidationError);
  });

  it('refuses the Name <address> form rather than unwrapping it', () => {
    // Unwrapping would mean deciding what they meant; the header that goes out
    // would then differ from the one they typed.
    expect(() => normalizeSalesRepEmail('Kevin <kevin@acme.com>')).toThrow(
      SalesRepEmailValidationError
    );
  });

  it.each([
    ['a comma-separated list', 'kevin@acme.com, sam@acme.com'],
    ['a semicolon-separated list', 'kevin@acme.com;sam@acme.com'],
  ])('refuses more than one address (%s) — a brand has ONE rep', (_label, input) => {
    expect(() => normalizeSalesRepEmail(input)).toThrow(SalesRepEmailValidationError);
  });

  it('refuses an address longer than a mail server accepts', () => {
    const tooLong = `${'a'.repeat(250)}@acme.com`;
    expect(() => normalizeSalesRepEmail(tooLong)).toThrow(SalesRepEmailValidationError);
  });

  it('names what to do, so the refusal can be rendered verbatim to a person', () => {
    try {
      normalizeSalesRepEmail('Kevin <kevin@acme.com>');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('kevin@acme.com');
    }
  });
});

/**
 * The ONE product rule, owner-stated: A PHONE REQUIRES AN EMAIL. It is enforced
 * at the write, never in the database — three production rows carry a phone and
 * no email, and a CHECK would recast a true record of a fact we do not have as
 * a constraint violation.
 */
describe('assertSalesRepWritable', () => {
  it('accepts a rep with both facts', () => {
    expect(() =>
      assertSalesRepWritable({ email: 'kevin@acme.com', phone: '+33770657585' })
    ).not.toThrow();
  });

  it('accepts an email with no phone — copied on replies, never rung', () => {
    expect(() => assertSalesRepWritable({ email: 'kevin@acme.com', phone: null })).not.toThrow();
  });

  it('refuses a phone with no email', () => {
    expect(() => assertSalesRepWritable({ email: null, phone: '+33770657585' })).toThrow(
      SalesRepEmailRequiredError
    );
  });

  it('refuses it with a sentence a person can act on', () => {
    try {
      assertSalesRepWritable({ email: null, phone: '+33770657585' });
      throw new Error('should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      // Says WHY (the rep is copied on the reply) and WHAT TO DO (send the field).
      expect(message).toContain('email address');
      expect(message).toContain('salesRepEmail');
      expect(message.length).toBeGreaterThan(80);
    }
  });

  it('says nothing about a rep carrying neither fact — that is a DELETE', () => {
    // The route names DELETE for this; the rule is only about phone-without-email.
    expect(() => assertSalesRepWritable({ email: null, phone: null })).not.toThrow();
  });
});
