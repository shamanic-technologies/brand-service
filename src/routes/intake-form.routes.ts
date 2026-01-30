import { Router, Request, Response } from 'express';
import pool from '../db';
import { intakeFormService } from '../services/intakeFormService';

const router = Router();

/**
 * POST /trigger-intake-form-generation
 * Triggers the n8n workflow to generate the intake form
 */
router.post('/trigger-intake-form-generation', async (req: Request, res: Response) => {
  console.log(`[${new Date().toISOString()}] Request body for /trigger-intake-form-generation:`, req.body);
  const { clerk_organization_id } = req.body;

  if (!clerk_organization_id) {
    return res.status(400).json({ error: 'clerk_organization_id is required' });
  }

  try {
    const client = await pool.connect();

    // Get organization ID using clerk_organization_id
    const orgQuery = `
      SELECT id, external_organization_id FROM organizations
      WHERE clerk_organization_id = $1
    `;
    
    const { rows: orgRows } = await client.query(orgQuery, [clerk_organization_id]);
    
    if (orgRows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Organization not found' });
    }

    const organizationId = orgRows[0].id;
    const externalOrganizationId = orgRows[0].external_organization_id;

    // Update or insert intake_forms with 'generating' status
    const upsertQuery = `
      INSERT INTO intake_forms (organization_id, status, generating_started_at)
      VALUES ($1, 'generating', NOW())
      ON CONFLICT (organization_id)
      DO UPDATE SET 
        status = 'generating',
        generating_started_at = NOW(),
        updated_at = NOW()
      RETURNING id, organization_id, status, generating_started_at
    `;
    
    const { rows } = await client.query(upsertQuery, [organizationId]);

    client.release();

    // Trigger the n8n webhook (still uses external_organization_id for n8n compatibility)
    const webhookUrl = process.env.N8N_CREATE_INTAKE_FORM_WEBHOOK_URL || 'https://pressbeat.app.n8n.cloud/webhook/8417db6e-32e4-44ee-bf07-e15e15a8b3c7';
    const webhookSecret = process.env.N8N_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('N8N webhook secret is not configured.');
      return res.status(500).json({ error: 'Webhook configuration error' });
    }

    const payload = [{
      signature: webhookSecret,
      external_organization_id: externalOrganizationId,
    }];

    console.log(`[${new Date().toISOString()}] Triggering intake form generation workflow for organization ${clerk_organization_id}`);

    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(error => {
      console.error('Webhook call failed in background:', error);
    });

    return res.status(200).json({ 
      message: 'Intake form generation workflow initiated successfully.',
      clerk_organization_id: clerk_organization_id,
      status: 'generating',
      generating_started_at: rows[0].generating_started_at
    });

  } catch (error) {
    console.error('Error triggering intake form generation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /intake-forms
 * Upsert intake form data (used for auto-save)
 */
router.post('/intake-forms', async (req: Request, res: Response) => {
  try {
    const data = req.body;

    if (!data.clerk_organization_id) {
      return res.status(400).json({ error: 'clerk_organization_id is required' });
    }

    const intakeForm = await intakeFormService.upsertIntakeFormByClerkId(data);
    
    return res.status(200).json({
      success: true,
      data: intakeForm,
    });
  } catch (error: any) {
    console.error('Error upserting intake form:', error);
    
    // Handle organization not found
    if (error.message?.includes('Organization not found')) {
      return res.status(404).json({ error: error.message });
    }
    
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /intake-forms/organization/:clerkOrganizationId
 * Get intake form by clerk organization ID
 */
router.get('/intake-forms/organization/:clerkOrganizationId', async (req: Request, res: Response) => {
  try {
    const { clerkOrganizationId } = req.params;

    if (!clerkOrganizationId) {
      return res.status(400).json({ error: 'clerkOrganizationId is required' });
    }

    const intakeForm = await intakeFormService.getByClerkOrganizationId(clerkOrganizationId);
    
    if (!intakeForm) {
      return res.status(404).json({ error: 'Intake form not found' });
    }

    return res.status(200).json({
      success: true,
      data: intakeForm,
    });
  } catch (error: any) {
    console.error('Error fetching intake form:', error);
    
    // Handle organization not found
    if (error.message?.includes('Organization not found')) {
      return res.status(404).json({ error: error.message });
    }
    
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
