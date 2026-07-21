import type { ProfileFields } from './brandProfileService';

export interface ProfileForContext {
  /**
   * True only when a HUMAN has confirmed at least one brand_user_fields row.
   * The derived fields (no confirmation) are just our own past field
   * extractions re-coerced — injecting them as authoritative would feed the
   * LLM its prior output and freeze any earlier error, so we never do that.
   * `fields` here must be the CONFIRMED-only layer, not the merged profile.
   */
  hasConfirmed: boolean;
  fields: ProfileFields;
}

/**
 * Build the client-validated brand-profile block injected into the field
 * extraction prompt. Returns null when the brand has no confirmed fields, or
 * when the confirmed fields carry no usable value.
 *
 * The instruction tells the LLM to treat the profile as the source of truth and
 * only override a profile value when the scraped website explicitly and
 * specifically contradicts it with clearly newer information — the client's
 * website is often outdated, the validated profile is not.
 */
export function buildProfileContextBlock(profile: ProfileForContext): string | null {
  if (!profile.hasConfirmed) return null;

  const entries = Object.entries(profile.fields).filter(([, value]) =>
    Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim().length > 0,
  );
  if (entries.length === 0) return null;

  const rendered = entries
    .map(([key, value]) => `- "${key}": ${Array.isArray(value) ? JSON.stringify(value) : value}`)
    .join('\n');

  return (
    `\n\nClient-validated brand profile (verified and approved by the client — treat this as the source of truth):\n` +
    `${rendered}\n` +
    `When the website content conflicts with, or is silent or ambiguous about, a field present in this profile, ` +
    `PREFER the profile value — the client's website may be outdated. ` +
    `Only override a profile value if the scraped content explicitly and specifically contradicts it with clearly newer information.\n`
  );
}
