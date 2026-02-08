import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, brands } from '../db';
import { getOrganizationIdByClerkId } from '../services/organizationUpsertService';
import { TriggerWorkflowRequestSchema } from '../schemas';

const router = Router();

/**
 * POST /trigger-client-info-workflow
 * Triggers the n8n workflow to process client information.
 * Creates the organization if it doesn't exist (upsert pattern).
 */
router.post('/trigger-client-info-workflow', async (req: Request, res: Response) => {
  console.log(`[${new Date().toISOString()}] Request body for /trigger-client-info-workflow:`, req.body);
  const parsed = TriggerWorkflowRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { clerk_organization_id } = parsed.data;

  try {
    // Get or create the brand (upsert pattern)
    const brandId = await getOrganizationIdByClerkId(clerk_organization_id);

    // Get brand details
    const brandResult = await db
      .select({
        id: brands.id,
        clerkOrgId: brands.clerkOrgId,
        externalOrganizationId: brands.externalOrganizationId,
      })
      .from(brands)
      .where(eq(brands.id, brandId))
      .limit(1);

    const externalOrganizationId = brandResult[0]?.externalOrganizationId;

    // Trigger the n8n webhook (still uses external_organization_id for n8n compatibility)
    const webhookUrl = process.env.N8N_CREATE_CLIENT_INFORMATION_WEBHOOK_URL || 'https://pressbeat.app.n8n.cloud/webhook/49564dce-bc15-41c3-bb88-a6b075f42737';
    const webhookSecret = process.env.N8N_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('N8N webhook secret is not configured.');
      return res.status(500).json({ error: 'Webhook configuration error' });
    }

    const payload = [
      {
        signature: webhookSecret,
        clerk_organization_id: clerk_organization_id,
        external_organization_id: externalOrganizationId,
      },
    ];

    console.log(`[${new Date().toISOString()}] Triggering n8n workflow for organization ${clerk_organization_id}`);

    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch((error) => {
      console.error('Webhook call failed in background:', error);
    });

    return res.status(200).json({
      message: 'Client information workflow initiated successfully.',
      clerk_organization_id: clerk_organization_id,
      status: 'generating',
      generating_started_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error triggering client info workflow:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
