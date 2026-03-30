/**
 * Pure utility functions for image URL extraction and filtering.
 * No DB or service dependencies — safe for unit testing.
 */

// Known tracking pixel / analytics domains to skip
const TRACKING_DOMAINS = [
  'facebook.com', 'google-analytics.com', 'doubleclick.net',
  'googletagmanager.com', 'pixel.', 'track.', 'analytics.',
  'beacon.', 'bat.bing.com', 'linkedin.com/px',
];

/**
 * Extract image URLs from markdown content.
 * Handles both markdown syntax ![alt](url) and HTML <img src="url">.
 * Resolves relative URLs against the page URL.
 */
export function parseImageUrls(
  markdown: string,
  pageUrl: string,
): Array<{ url: string; altText: string; surroundingContext: string }> {
  const results: Array<{ url: string; altText: string; surroundingContext: string }> = [];
  const seen = new Set<string>();

  // Markdown images: ![alt](url)
  const mdImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = mdImageRegex.exec(markdown)) !== null) {
    const altText = match[1];
    const rawUrl = match[2].split(/\s/)[0]; // strip title if present
    const resolved = resolveUrl(rawUrl, pageUrl);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      const start = Math.max(0, match.index - 200);
      const end = Math.min(markdown.length, match.index + match[0].length + 200);
      results.push({
        url: resolved,
        altText,
        surroundingContext: markdown.slice(start, end).replace(/\n+/g, ' ').trim(),
      });
    }
  }

  // HTML img tags: <img...src="url"...>
  const htmlImgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  while ((match = htmlImgRegex.exec(markdown)) !== null) {
    const rawUrl = match[1];
    const resolved = resolveUrl(rawUrl, pageUrl);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      const altMatch = match[0].match(/alt=["']([^"']*)["']/i);
      const altText = altMatch?.[1] || '';
      const start = Math.max(0, match.index - 200);
      const end = Math.min(markdown.length, match.index + match[0].length + 200);
      results.push({
        url: resolved,
        altText,
        surroundingContext: markdown.slice(start, end).replace(/\n+/g, ' ').trim(),
      });
    }
  }

  return results;
}

function resolveUrl(rawUrl: string, pageUrl: string): string | null {
  try {
    if (rawUrl.startsWith('data:') || rawUrl.startsWith('#')) return null;
    return new URL(rawUrl, pageUrl).href;
  } catch {
    return null;
  }
}

export function isTrackingPixelDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return TRACKING_DOMAINS.some((d) => hostname.includes(d));
  } catch {
    return false;
  }
}

export function getExtensionFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split('.').pop()?.toLowerCase();
    if (ext && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'avif', 'bmp', 'tiff'].includes(ext)) {
      return ext;
    }
    return '';
  } catch {
    return '';
  }
}
