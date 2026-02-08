import { Router, Request, Response } from 'express';
import axios from 'axios';
import { eq, sql } from 'drizzle-orm';
import { db, brands, brandThesis } from '../db';
import { TriggerWorkflowRequestSchema } from '../schemas';

const router = Router();

const PRESS_FUNNEL_SERVICE_URL = process.env.PRESS_FUNNEL_SERVICE_URL || 'https://press-funnel-production.up.railway.app';
const PRESS_FUNNEL_API_KEY = process.env.PRESS_FUNNEL_API_KEY || '';

/**
 * POST /trigger-thesis-generation
 * Triggers the n8n workflow to generate thesis statements.
 */
router.post('/trigger-thesis-generation', async (req: Request, res: Response) => {
  console.log(`[${new Date().toISOString()}] Request body for /trigger-thesis-generation:`, req.body);
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

    const externalOrganizationId = brandResult[0].externalOrganizationId;
    const triggered_at = new Date().toISOString();

    // Trigger the n8n webhook
    const webhookUrl =
      process.env.N8N_CREATE_ORGANIZATION_THESIS_WEBHOOK_URL ||
      'https://pressbeat.app.n8n.cloud/webhook/3d763feb-08fb-4535-99cd-6bb79fd3befb';
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
      `[${new Date().toISOString()}] Triggering thesis generation workflow for organization ${clerk_organization_id}`
    );

    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch((error) => {
      console.error('Webhook call failed in background:', error);
    });

    return res.status(200).json({
      message: 'Thesis generation workflow initiated successfully.',
      clerk_organization_id: clerk_organization_id,
      triggered_at: triggered_at,
    });
  } catch (error) {
    console.error('Error triggering thesis generation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /clients-theses-need-update
 * Returns list of clients that need their thesis statements updated.
 */
router.get('/clients-theses-need-update', async (req: Request, res: Response) => {
  const filter = req.query.filter as string | undefined;

  try {
    // Get thesis data from brand-service database
    const thesisData = await db
      .select({
        clerkOrgId: brands.clerkOrgId,
        lastThesisUpdate: sql<string>`MAX(${brandThesis.updatedAt})`,
        thesisCount: sql<number>`COUNT(${brandThesis.id})::integer`,
      })
      .from(brands)
      .leftJoin(brandThesis, eq(brands.id, brandThesis.brandId))
      .where(sql`${brands.clerkOrgId} IS NOT NULL`)
      .groupBy(brands.clerkOrgId);

    // Create thesis lookup map
    const thesisMap = new Map(
      thesisData.map((row) => [
        row.clerkOrgId,
        { lastUpdate: row.lastThesisUpdate, count: row.thesisCount },
      ])
    );

    // Get public info status from press-funnel
    let pressFunnelData: any[] = [];
    try {
      const pressFunnelResponse = await axios.get(
        `${PRESS_FUNNEL_SERVICE_URL}/client-organizations/theses-status`,
        {
          headers: { 'X-API-Key': PRESS_FUNNEL_API_KEY },
          params: filter ? { filter } : {},
          timeout: 10000,
        }
      );
      pressFunnelData = pressFunnelResponse.data.organizations || [];
    } catch (error) {
      console.error('Error fetching from press-funnel:', error);
      return res.status(500).json({ error: 'Failed to fetch data from press-funnel' });
    }

    // Get active subscription status from press-funnel
    let subscriptionData: any[] = [];
    try {
      const subscriptionResponse = await axios.get(
        `${PRESS_FUNNEL_SERVICE_URL}/subscriptions/active-status`,
        {
          headers: { 'X-API-Key': PRESS_FUNNEL_API_KEY },
          timeout: 10000,
        }
      );
      subscriptionData = subscriptionResponse.data.organizations || [];
    } catch (error) {
      console.error('Error fetching active subscription status from press-funnel:', error);
      return res.status(500).json({ error: 'Failed to fetch active subscription status from press-funnel' });
    }

    const subscriptionMap = new Map(
      subscriptionData.map((row: any) => [
        row.clerk_organization_id,
        { hasActive: row.has_active_subscription, status: row.subscription_status },
      ])
    );

    // Get task running status from press-funnel
    let taskSetupData: any[] = [];
    try {
      const taskSetupResponse = await axios.get(
        `${PRESS_FUNNEL_SERVICE_URL}/client-organizations/theses-task-setup`,
        {
          headers: { 'X-API-Key': PRESS_FUNNEL_API_KEY },
          timeout: 10000,
        }
      );
      taskSetupData = taskSetupResponse.data.organizations || [];
    } catch (error) {
      console.error('Error fetching theses task setup from press-funnel:', error);
    }

    const taskSetupMap = new Map(
      taskSetupData.map((row: any) => [row.clerk_organization_id, { isRunning: row.is_running }])
    );

    // Combine all data
    const results = pressFunnelData.map((row: any) => {
      const subscriptionInfo = row.clerk_organization_id
        ? subscriptionMap.get(row.clerk_organization_id) || { hasActive: false, status: 'Not found' }
        : { hasActive: false, status: 'No clerk_organization_id' };

      const thesisInfo = row.clerk_organization_id
        ? thesisMap.get(row.clerk_organization_id) || { lastUpdate: null, count: 0 }
        : { lastUpdate: null, count: 0 };

      const taskSetupInfo = row.clerk_organization_id
        ? taskSetupMap.get(row.clerk_organization_id) || { isRunning: false }
        : { isRunning: false };

      const isRunning = taskSetupInfo.isRunning;

      const thesesOld =
        !thesisInfo.lastUpdate || new Date(thesisInfo.lastUpdate) < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const needsUpdate = subscriptionInfo.hasActive && row.is_public_info_ready && !isRunning && thesesOld;

      let statusReason: string;
      if (!subscriptionInfo.hasActive) {
        statusReason = `No active subscription (${subscriptionInfo.status})`;
      } else if (!row.is_public_info_ready) {
        statusReason = 'Public Information not ready';
      } else if (isRunning) {
        statusReason = 'Task currently running';
      } else if (!thesisInfo.lastUpdate) {
        statusReason = 'No theses created yet';
      } else if (thesesOld) {
        statusReason = 'Theses older than 1 month';
      } else {
        statusReason = 'Updated < 1 month ago';
      }

      const dates = [
        row.last_updated_at ? new Date(row.last_updated_at) : null,
        thesisInfo.lastUpdate ? new Date(thesisInfo.lastUpdate) : null,
        row.public_info_updated_at ? new Date(row.public_info_updated_at) : null,
      ].filter((d): d is Date => d !== null);

      const lastUpdatedAt =
        dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString() : row.last_updated_at;

      return {
        client_organization_id: row.client_organization_id,
        client_organization_name: row.client_organization_name,
        client_organization_url: row.client_organization_url,
        clerk_organization_id: row.clerk_organization_id,
        organization_created_at: row.organization_created_at,
        is_public_info_ready: row.is_public_info_ready,
        public_info_updated_at: row.public_info_updated_at,
        last_thesis_update: thesisInfo.lastUpdate,
        last_updated_at: lastUpdatedAt,
        has_active_subscription: subscriptionInfo.hasActive,
        subscription_status: subscriptionInfo.status,
        is_running: isRunning,
        theses_need_update: needsUpdate,
        status_reason: statusReason,
      };
    });

    const stats = {
      total: results.length,
      needUpdate: results.filter((r) => r.theses_need_update).length,
      hasActiveSubscription: results.filter((r) => r.has_active_subscription).length,
      isRunning: results.filter((r) => r.is_running).length,
      publicInfoReady: results.filter((r) => r.is_public_info_ready).length,
    };

    return res.status(200).json({ organizations: results, stats });
  } catch (error) {
    console.error('Error fetching clients theses need update:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /theses-setup
 * Returns thesis setup status for all organizations.
 */
router.get('/theses-setup', async (req: Request, res: Response) => {
  try {
    const result = await db
      .select({
        clerkOrgId: brands.clerkOrgId,
        organizationName: brands.name,
        validatedCount: sql<number>`COUNT(${brandThesis.id}) FILTER (WHERE ${brandThesis.status} = 'validated')::integer`,
        userValidatedCount: sql<number>`COUNT(${brandThesis.id}) FILTER (WHERE ${brandThesis.status} = 'validated' AND ${brandThesis.statusChangedByType} = 'user')::integer`,
        aiValidatedCount: sql<number>`COUNT(${brandThesis.id}) FILTER (WHERE ${brandThesis.status} = 'validated' AND ${brandThesis.statusChangedByType} = 'ai')::integer`,
        deniedCount: sql<number>`COUNT(${brandThesis.id}) FILTER (WHERE ${brandThesis.status} = 'denied')::integer`,
        lastUpdatedAt: sql<string>`MAX(${brandThesis.updatedAt})`,
      })
      .from(brands)
      .leftJoin(brandThesis, eq(brands.id, brandThesis.brandId))
      .where(sql`${brands.clerkOrgId} IS NOT NULL`)
      .groupBy(brands.clerkOrgId, brands.name)
      .orderBy(sql`MAX(${brandThesis.updatedAt}) DESC NULLS LAST`);

    const organizations = result.map((row) => {
      const hasValidated = row.validatedCount > 0;
      const isSetup = hasValidated;

      let statusReason: string;
      if (row.userValidatedCount > 0) {
        statusReason = `${row.userValidatedCount} user validated`;
      } else if (row.aiValidatedCount > 0) {
        statusReason = `${row.aiValidatedCount} AI suggested (needs review)`;
      } else if (row.deniedCount > 0) {
        statusReason = `${row.deniedCount} denied`;
      } else {
        statusReason = 'No thesis';
      }

      return {
        clerk_organization_id: row.clerkOrgId,
        organization_name: row.organizationName,
        has_thesis: hasValidated,
        validated_count: row.validatedCount,
        user_validated_count: row.userValidatedCount,
        ai_validated_count: row.aiValidatedCount,
        denied_count: row.deniedCount,
        is_setup: isSetup,
        status_reason: statusReason,
        updated_at: row.lastUpdatedAt,
      };
    });

    const stats = {
      total: organizations.length,
      setup: organizations.filter((o) => o.is_setup).length,
      notSetup: organizations.filter((o) => !o.is_setup).length,
      withUserValidated: organizations.filter((o) => o.user_validated_count > 0).length,
      withAiSuggested: organizations.filter((o) => o.ai_validated_count > 0 && o.user_validated_count === 0).length,
    };

    return res.status(200).json({ organizations, stats });
  } catch (error) {
    console.error('Error fetching theses setup status:', error);
    return res.status(500).json({ error: 'Failed to fetch theses setup status' });
  }
});

export default router;
