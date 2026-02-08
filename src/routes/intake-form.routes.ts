import { Router, Request, Response } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db, brands, intakeForms } from '../db';
import { intakeFormService } from '../services/intakeFormService';
import { TriggerWorkflowRequestSchema, IntakeFormUpsertRequestSchema } from '../schemas';

const router = Router();

/**
 * POST /trigger-intake-form-generation
 * Triggers the n8n workflow to generate the intake form
 */
router.post('/trigger-intake-form-generation', async (req: Request, res: Response) => {
  console.log(`[${new Date().toISOString()}] Request body for /trigger-intake-form-generation:`, req.body);
  const parsed = TriggerWorkflowRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { clerk_organization_id } = parsed.data;

  try {
    // Get brand using clerk_organization_id
    const brandResult = await db
      .select({ id: brands.id, externalOrganizationId: brands.externalOrganizationId })
      .from(brands)
      .where(eq(brands.clerkOrgId, clerk_organization_id))
      .limit(1);

    if (brandResult.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const brandId = brandResult[0].id;
    const externalOrganizationId = brandResult[0].externalOrganizationId;

    // Update or insert intake_forms with 'generating' status
    const upsertResult = await db
      .insert(intakeForms)
      .values({
        brandId,
        status: 'generating',
        generatingStartedAt: sql`NOW()`,
      })
      .onConflictDoUpdate({
        target: intakeForms.brandId,
        set: {
          status: 'generating',
          generatingStartedAt: sql`NOW()`,
          updatedAt: sql`NOW()`,
        },
      })
      .returning({
        id: intakeForms.id,
        brandId: intakeForms.brandId,
        status: intakeForms.status,
        generatingStartedAt: intakeForms.generatingStartedAt,
      });

    // Trigger the n8n webhook (still uses external_organization_id for n8n compatibility)
    const webhookUrl =
      process.env.N8N_CREATE_INTAKE_FORM_WEBHOOK_URL ||
      'https://pressbeat.app.n8n.cloud/webhook/8417db6e-32e4-44ee-bf07-e15e15a8b3c7';
    const webhookSecret = process.env.N8N_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('N8N webhook secret is not configured.');
      return res.status(500).json({ error: 'Webhook configuration error' });
    }

    const payload = [
      {
        signature: webhookSecret,
        external_organization_id: externalOrganizationId,
      },
    ];

    console.log(
      `[${new Date().toISOString()}] Triggering intake form generation workflow for organization ${clerk_organization_id}`
    );

    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch((error) => {
      console.error('Webhook call failed in background:', error);
    });

    return res.status(200).json({
      message: 'Intake form generation workflow initiated successfully.',
      clerk_organization_id: clerk_organization_id,
      status: 'generating',
      generating_started_at: upsertResult[0].generatingStartedAt,
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
    const parsed = IntakeFormUpsertRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const intakeForm = await intakeFormService.upsertIntakeFormByClerkId(parsed.data);

    return res.status(200).json({
      success: true,
      data: intakeForm,
    });
  } catch (error: any) {
    console.error('Error upserting intake form:', error);

    if (error.message?.includes('not found')) {
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

    if (error.message?.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
