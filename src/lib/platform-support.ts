/**
 * The support function a chat-service PLATFORM call declares when no
 * brand-service run stands behind it by design (PLATFORM-CALLER-RUN-1024).
 * Pure module (no fetch, no db) so a test mocking `chat-client` keeps it.
 */

/** chat-service's closed support vocabulary (its `SUPPORT_FUNCTIONS`). */
export type PlatformSupportKind =
  | 'payment_fees'
  | 'brand_setup'
  | 'copilot'
  | 'platform_llm'
  | 'staff_experiment'
  | 'product_feature'
  | 'retired_product';

export interface PlatformSupport {
  kind: PlatformSupportKind;
  /** One plain sentence: why no run stands behind this call. */
  reason: string;
}

/** The support mark of a platform call brand-service makes with no run of its own: brand setup. */
export function brandSetupSupport(reason: string): PlatformSupport {
  return { kind: 'brand_setup', reason };
}

