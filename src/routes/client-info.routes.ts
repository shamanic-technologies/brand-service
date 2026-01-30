import { Router, Request, Response } from 'express';
import pool from '../db';
import { getOrganizationIdByClerkId } from '../services/organizationUpsertService';

const router = Router();

/**
 * POST /trigger-client-info-workflow
 * Triggers the n8n workflow to process client information.
 * Creates the organization if it doesn't exist (upsert pattern).
 */
router.post('/trigger-client-info-workflow', async (req: Request, res: Response) => {
  console.log(`[${new Date().toISOString()}] Request body for /trigger-client-info-workflow:`, req.body);
  const { clerk_organization_id } = req.body;

  if (!clerk_organization_id) {
    return res.status(400).json({ error: 'clerk_organization_id is required' });
  }

  try {
    const client = await pool.connect();

    // Get or create the organization (upsert pattern)
    const organizationId = await getOrganizationIdByClerkId(clerk_organization_id);

    // DEPRECATED: No longer updating organizations.status - status is now tracked in billed_task_runs (press-funnel)
    // Just get the external_organization_id for n8n
    const getOrgQuery = `
      SELECT id, clerk_organization_id, external_organization_id
      FROM organizations
      WHERE id = $1
    `;
    
    const { rows } = await client.query(getOrgQuery, [organizationId]);
    
    const externalOrganizationId = rows[0]?.external_organization_id;

    client.release();

    // Trigger the n8n webhook (still uses external_organization_id for n8n compatibility)
    const webhookUrl = process.env.N8N_CREATE_CLIENT_INFORMATION_WEBHOOK_URL || 'https://pressbeat.app.n8n.cloud/webhook/49564dce-bc15-41c3-bb88-a6b075f42737';
    const webhookSecret = process.env.N8N_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('N8N webhook secret is not configured.');
      return res.status(500).json({ error: 'Webhook configuration error' });
    }

    const payload = [{
      signature: webhookSecret,
      clerk_organization_id: clerk_organization_id,
      external_organization_id: externalOrganizationId, // May be null for new orgs
    }];

    console.log(`[${new Date().toISOString()}] Triggering n8n workflow for organization ${clerk_organization_id}`);

    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(error => {
      console.error('Webhook call failed in background:', error);
    });

    // Return immediate feedback - actual status will be tracked in billed_task_runs
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
