import 'express';

declare global {
  namespace Express {
    interface Request {
      orgId?: string;
      userId?: string;
      runId?: string;
      campaignId?: string;
      featureSlug?: string;
      brandIdHeader?: string;
      /** Parsed brand IDs from x-brand-id header (CSV-split) */
      brandIds?: string[];
      workflowSlug?: string;
      /** Audience attribution ID (human-service org-scoped saved filter-set, audience.id). From x-audience-id. */
      audienceId?: string;
    }
  }
}
