/**
 * A replacement logo is a URL a CUSTOMER typed, and a dashboard renders it as an
 * image with no further inspection. So what we accept is what somebody else's
 * browser will fetch — validate it here and refuse the rest loudly, rather than
 * storing a string a consumer will render blindly.
 *
 * What is accepted: an absolute `https://` URL on a public hostname. Nothing
 * else. In particular:
 *
 * - `http://` is refused — a dashboard served over https renders a mixed-content
 *   image as nothing at all, so it fails silently at exactly the wrong moment.
 * - `data:` / `javascript:` / `blob:` and every other scheme is refused: those
 *   are not hosted files, and one of them is an injection vector the moment a
 *   consumer puts the value anywhere but an `<img src>`.
 * - userinfo (`https://user:pass@host/...`) is refused — a credential in a value
 *   we hand to every reader of the brand is a credential we have leaked.
 * - `localhost`, IP literals and hostnames with no TLD are refused, matching what
 *   `normalizeUrl` already refuses for a brand's website.
 *
 * NOT checked: the file extension or the response content-type. The dashboard
 * uploads to our own object storage and hands back whatever URL that returns —
 * commonly signed, with a query string and no extension — so an extension check
 * would refuse the normal case. The bytes are our storage's business.
 */
import { isIP } from 'net';
import { z } from 'zod';

export class InvalidLogoUrlError extends Error {
  readonly code = 'INVALID_LOGO_URL';
  readonly field = 'logoUrl';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidLogoUrlError';
  }
}

/** Long enough for a signed storage URL, short enough to never be a payload. */
export const LOGO_URL_MAX_CHARS = 2048;

export function normalizeLogoUrl(input: unknown): string {
  if (typeof input !== 'string') {
    throw new InvalidLogoUrlError('logoUrl must be a string');
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new InvalidLogoUrlError('logoUrl is empty');
  }
  if (trimmed.length > LOGO_URL_MAX_CHARS) {
    throw new InvalidLogoUrlError(`logoUrl is longer than ${LOGO_URL_MAX_CHARS} characters`);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new InvalidLogoUrlError(
      'logoUrl must be an absolute https:// URL to an already-hosted image',
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new InvalidLogoUrlError(
      `Unsupported logoUrl scheme "${parsed.protocol}". Only https:// is accepted.`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new InvalidLogoUrlError('logoUrl must not carry credentials');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname.length === 0) {
    throw new InvalidLogoUrlError('logoUrl has no hostname');
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new InvalidLogoUrlError('logoUrl must not point at localhost');
  }
  if (isIP(hostname.replace(/^\[|\]$/g, '')) !== 0) {
    throw new InvalidLogoUrlError('logoUrl must not point at an IP literal');
  }
  if (!hostname.includes('.') || hostname.endsWith('.')) {
    throw new InvalidLogoUrlError(`logoUrl hostname is missing a TLD: ${hostname}`);
  }

  parsed.hostname = hostname;
  return parsed.toString();
}

const LOGO_URL_ISSUE_PREFIX = 'INVALID_LOGO_URL: ';

/** Zod wrapper so a bad logo URL is a 400 from the route's own body parse. */
export const LogoUrlSchema = z.string().transform((val, ctx) => {
  try {
    return normalizeLogoUrl(val);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Invalid logo URL';
    ctx.addIssue({ code: 'custom', message: `${LOGO_URL_ISSUE_PREFIX}${message}` });
    return z.NEVER;
  }
});

/**
 * Recover the error code a `LogoUrlSchema` issue carries, so the route answers
 * `INVALID_LOGO_URL` rather than a generic validation failure.
 */
export function parseLogoUrlIssue(
  message: string | undefined,
): { code: string; message: string } | null {
  if (message && message.startsWith(LOGO_URL_ISSUE_PREFIX)) {
    return { code: 'INVALID_LOGO_URL', message: message.slice(LOGO_URL_ISSUE_PREFIX.length) };
  }
  return null;
}
