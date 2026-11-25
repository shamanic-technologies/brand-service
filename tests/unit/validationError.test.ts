import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { describeValidationError, invalidRequestBody } from '../../src/lib/validation-error';
import { ProposeOffersRequestSchema, ConfirmOffersRequestSchema, SuggestIcpRequestSchema } from '../../src/schemas';

// AGENT-SIGNUP-UX-1125: an outside AI agent read only the top-level `error` and
// got "Invalid request" four times. Every 400 now names the field + expectation.
function errorOf(schema: z.ZodTypeAny, body: unknown) {
  const parsed = schema.safeParse(body);
  if (parsed.success) throw new Error('expected a validation failure');
  return parsed.error;
}

describe('invalidRequestBody', () => {
  it('names a missing array field and keeps details byte-identical to flatten()', () => {
    const error = errorOf(ConfirmOffersRequestSchema, {});
    const body = invalidRequestBody(error);
    expect(body.error).toBe('Invalid request: offers: Invalid input: expected array, received undefined');
    expect(body.details).toEqual(error.flatten());
  });

  it('names a bad uuid on one line', () => {
    expect(describeValidationError(errorOf(SuggestIcpRequestSchema, { offerId: '' }))).toBe(
      'Invalid request: offerId: Invalid UUID',
    );
  });

  it('says which alternatives a union body accepts', () => {
    const message = describeValidationError(errorOf(ProposeOffersRequestSchema, {}));
    expect(message).toBe(
      'Invalid request: body matches none of the accepted shapes ' +
        '({ source: Invalid input: expected "site" } OR { description: Invalid input: expected string, received undefined })',
    );
  });

  it('appends the hint of the offending field, nested paths included, once', () => {
    const schema = z.object({ offers: z.array(z.object({ name: z.string() })) });
    const message = describeValidationError(errorOf(schema, { offers: [{}, {}] }), { offers: 'From the proposals answer.' });
    expect(message).toMatch(/^Invalid request: offers\.0\.name: .*; offers\.1\.name: /);
    expect(message.endsWith('. From the proposals answer.')).toBe(true);
    expect(message.split('From the proposals answer.').length).toBe(2);
  });

  it('uses the whole-body hint for a root issue', () => {
    expect(describeValidationError(errorOf(z.object({ a: z.string() }), 'x'), { '': 'Send an object.' })).toMatch(
      /^Invalid request: body: .*\. Send an object\.$/,
    );
  });

  it('caps the list at 5 issues and counts the rest', () => {
    const schema = z.object(Object.fromEntries('abcdefg'.split('').map((k) => [k, z.string()])));
    expect(describeValidationError(errorOf(schema, {}))).toMatch(/\(\+2 more in details\)$/);
  });
});
