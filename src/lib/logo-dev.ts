/**
 * logo.dev URL builder.
 *
 * brands.logo_url is lazy-filled in the same way as brands.name: when a brand
 * row's logo_url is NULL on first access, we deterministically derive a
 * logo.dev URL from the brand's domain and persist it. logo.dev returns a
 * favicon-style logo image for any domain.
 *
 * Token is read from LOGO_DEV_TOKEN (required at runtime).
 */

const LOGO_DEV_BASE = 'https://img.logo.dev';
const DEFAULT_SIZE = 256;
const DEFAULT_FORMAT = 'png';

export function buildLogoDevUrl(domain: string, opts: { size?: number; format?: 'png' | 'jpg' | 'webp' } = {}): string {
  const token = process.env.LOGO_DEV_TOKEN;
  if (!token) {
    throw new Error('[brand-service] LOGO_DEV_TOKEN env var is not set');
  }
  const size = opts.size ?? DEFAULT_SIZE;
  const format = opts.format ?? DEFAULT_FORMAT;
  const encoded = encodeURIComponent(domain);
  return `${LOGO_DEV_BASE}/${encoded}?token=${token}&size=${size}&format=${format}`;
}
