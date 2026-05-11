import { isIP } from 'net';
import { z } from 'zod';

export class InvalidUrlError extends Error {
  readonly code = 'INVALID_URL';
  readonly field: string;

  constructor(message: string, field = 'url') {
    super(message);
    this.name = 'InvalidUrlError';
    this.field = field;
  }
}

export class UrlRequiredError extends Error {
  readonly code = 'URL_REQUIRED';
  readonly field: string;

  constructor(message = 'URL is required to create a brand', field = 'url') {
    super(message);
    this.name = 'UrlRequiredError';
    this.field = field;
  }
}

const HOSTNAME_LABEL_RE = /^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$/i;
const PUNYCODE_LABEL_RE = /^xn--[a-z0-9-]+$/i;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

export function normalizeUrl(input: unknown, field = 'url'): string {
  if (typeof input !== 'string') {
    throw new InvalidUrlError('URL must be a string', field);
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new InvalidUrlError('URL is empty', field);
  }

  const candidate = SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new InvalidUrlError(`Cannot parse URL: ${input}`, field);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidUrlError(
      `Unsupported URL scheme "${parsed.protocol}". Use http:// or https://.`,
      field,
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname.length === 0) {
    throw new InvalidUrlError(`Empty hostname in URL: ${input}`, field);
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new InvalidUrlError(`Localhost not allowed: ${input}`, field);
  }

  const ipCandidate = hostname.replace(/^\[|\]$/g, '');
  if (isIP(ipCandidate) !== 0) {
    throw new InvalidUrlError(`IP literal not allowed: ${input}`, field);
  }

  const labels = hostname.split('.');
  if (labels.length < 2) {
    throw new InvalidUrlError(`Hostname missing TLD: ${hostname}`, field);
  }
  for (const label of labels) {
    if (label.length === 0) {
      throw new InvalidUrlError(`Empty hostname label in: ${hostname}`, field);
    }
    if (!HOSTNAME_LABEL_RE.test(label) && !PUNYCODE_LABEL_RE.test(label)) {
      throw new InvalidUrlError(`Invalid hostname label "${label}" in: ${hostname}`, field);
    }
  }
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/i.test(tld) && !PUNYCODE_LABEL_RE.test(tld)) {
    throw new InvalidUrlError(`Invalid TLD "${tld}" in hostname: ${hostname}`, field);
  }

  parsed.hostname = hostname;
  const serialized = parsed.toString();
  if (parsed.pathname === '/' && !parsed.search && !parsed.hash) {
    return serialized.replace(/\/$/, '');
  }
  return serialized;
}

export function extractDomain(input: unknown, field = 'url'): string {
  const normalized = normalizeUrl(input, field);
  const hostname = new URL(normalized).hostname.toLowerCase();
  return hostname.replace(/^www\./, '');
}

const URL_ISSUE_PREFIX = 'INVALID_URL: ';

export const BrandUrlSchema = z
  .string({ error: 'url must be a string' })
  .transform((val, ctx) => {
    try {
      return normalizeUrl(val);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Invalid URL';
      ctx.addIssue({ code: 'custom', message: `${URL_ISSUE_PREFIX}${message}` });
      return z.NEVER;
    }
  });

export const OptionalBrandUrlSchema = z
  .string()
  .optional()
  .transform((val, ctx) => {
    if (val === undefined || val === null || val === '') return undefined;
    try {
      return normalizeUrl(val);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Invalid URL';
      ctx.addIssue({ code: 'custom', message: `${URL_ISSUE_PREFIX}${message}` });
      return z.NEVER;
    }
  });

export function parseZodIssueCode(message: string | undefined): { code: string; message: string } {
  if (message && message.startsWith(URL_ISSUE_PREFIX)) {
    return { code: 'INVALID_URL', message: message.slice(URL_ISSUE_PREFIX.length) };
  }
  return { code: 'INVALID_REQUEST', message: message ?? 'Invalid request' };
}
