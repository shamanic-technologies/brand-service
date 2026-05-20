import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
// LEGACY: reads `brands_old` for external_organization_id semantics.
import { db, brandsOld as brands } from '../db';
import { getOrganizationIdByOrgId } from '../services/organizationUpsertService';
import { InvalidUrlError, UrlRequiredError } from '../lib/url-utils';
import { TriggerWorkflowRequestSchema } from '../schemas';

const router = Router();

/**
 * POST /trigger-client-info-workflow
 * Triggers the n8n workflow to process client information.
 * Requires an existing brand for the organization — does NOT auto-create a skeleton.
 * Call POST /orgs/brands first if the brand doesn't exist yet.
 */
router.post('/trigger-client-info-workflow', async (req: Request, res: Response) => {
  console.log(`[brand-service] /trigger-client-info-workflow body=${JSON.stringify(req.body)}`);
  const parsed = TriggerWorkflowRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({
      error: 'Invalid request',
      code: 'INVALID_REQUEST',
      field: issue?.path?.join('.') ?? null,
      message: issue?.message ?? 'Invalid request',
      details: parsed.error.flatten(),
    });
  }
  const { organization_id } = parsed.data;

  try {
    const brandId = await getOrganizationIdByOrgId(organization_id);

    const brandResult = await db
      .select({
        id: brands.id,
        externalOrganizationId: brands.externalOrganizationId,
      })
      .from(brands)
      .where(eq(brands.id, brandId))
      .limit(1);

    const externalOrganizationId = brandResult[0]?.externalOrganizationId;

    const webhookUrl = process.env.N8N_CREATE_CLIENT_INFORMATION_WEBHOOK_URL || 'https://pressbeat.app.n8n.cloud/webhook/49564dce-bc15-41c3-bb88-a6b075f42737';
    const webhookSecret = process.env.N8N_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('[brand-service] N8N webhook secret is not configured.');
      return res.status(500).json({ error: 'Webhook configuration error' });
    }

    const payload = [
      {
        signature: webhookSecret,
        organization_id: organization_id,
        external_organization_id: externalOrganizationId,
      },
    ];

    console.log(`[brand-service] Triggering n8n workflow for organization ${organization_id}`);

    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch((error) => {
      console.error('[brand-service] Webhook call failed in background:', error);
    });

    return res.status(200).json({
      message: 'Client information workflow initiated successfully.',
      organization_id: organization_id,
      status: 'generating',
      generating_started_at: new Date().toISOString(),
    });
  } catch (error: unknown) {
    if (error instanceof UrlRequiredError || error instanceof InvalidUrlError) {
      return res.status(400).json({
        error: 'Brand has not been created for this organization yet. Call POST /orgs/brands first.',
        code: error.code,
        field: error.field,
        message: error.message,
      });
    }
    console.error('[brand-service] Error triggering client info workflow:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
