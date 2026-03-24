import 'express';

declare global {
  namespace Express {
    interface Request {
      orgId: string;
      userId: string;
      runId: string;
      campaignId?: string;
      featureSlug?: string;
      brandIdHeader?: string;
      workflowName?: string;
    }
  }
}
