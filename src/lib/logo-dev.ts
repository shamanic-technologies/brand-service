/**
 * logo.dev URL builder.
 *
 * brands.logo_url is lazy-filled in the same way as brands.name: when a
 * brand row's logo_url is NULL on first access, we deterministically derive
 * a logo.dev URL from the brand's domain and persist it. logo.dev returns a
 * favicon-style logo image for any domain.
 *
 * The publishable token is resolved at call time via key-service as a
 * platform-scoped key (provider: "logo-dev"). The token is never read from
 * the environment.
 */

import { getPlatformKey } from './keys-service';

const LOGO_DEV_BASE = 'https://img.logo.dev';
const DEFAULT_SIZE = 256;
const DEFAULT_FORMAT = 'png';
const LOGO_DEV_PROVIDER = 'logo-dev';

export interface BuildLogoDevUrlOptions {
  size?: number;
  format?: 'png' | 'jpg' | 'webp';
}

export async function buildLogoDevUrl(domain: string, opts: BuildLogoDevUrlOptions = {}): Promise<string> {
  const size = opts.size ?? DEFAULT_SIZE;
  const format = opts.format ?? DEFAULT_FORMAT;
  const token = await getPlatformKey(LOGO_DEV_PROVIDER, {
    method: 'GET',
    path: '/internal/brands/{id}',
  });
  const encoded = encodeURIComponent(domain);
  return `${LOGO_DEV_BASE}/${encoded}?token=${token}&size=${size}&format=${format}`;
}
