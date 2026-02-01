import { Router, Request, Response } from 'express';
import axios from 'axios';
import pool from '../db-legacy';

const router = Router();

// Service URLs and API keys
const PRESS_FUNNEL_SERVICE_URL = process.env.PRESS_FUNNEL_SERVICE_URL || 'https://press-funnel-production.up.railway.app';
const PRESS_FUNNEL_API_KEY = process.env.PRESS_FUNNEL_API_KEY || '';
const CLIENT_SERVICE_URL = process.env.CLIENT_SERVICE_URL || 'https://client.pressbeat.io';
const CLIENT_SERVICE_API_KEY = process.env.CLIENT_SERVICE_API_KEY || '';

/**
 * POST /trigger-thesis-generation
 * Triggers the n8n workflow to generate thesis statements.
 * Note: 'generating' status is deprecated. We no longer update thesis status here.
 * The n8n workflow will create/update theses with status='validated' and status_changed_by_type='ai'.
 */
router.post('/trigger-thesis-generation', async (req: Request, res: Response) => {
  console.log(`[${new Date().toISOString()}] Request body for /trigger-thesis-generation:`, req.body);
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

    const externalOrganizationId = orgRows[0].external_organization_id;
    const triggered_at = new Date().toISOString();

    client.release();

    // Trigger the n8n webhook (still uses external_organization_id for n8n compatibility)
    const webhookUrl = process.env.N8N_CREATE_ORGANIZATION_THESIS_WEBHOOK_URL || 'https://pressbeat.app.n8n.cloud/webhook/3d763feb-08fb-4535-99cd-6bb79fd3befb';
    const webhookSecret = process.env.N8N_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('N8N webhook secret is not configured.');
      return res.status(500).json({ error: 'Webhook configuration error' });
    }

    const payload = [{
      signature: webhookSecret,
      external_organization_id: externalOrganizationId,
    }];

    console.log(`[${new Date().toISOString()}] Triggering thesis generation workflow for organization ${clerk_organization_id}`);

    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(error => {
      console.error('Webhook call failed in background:', error);
    });

    return res.status(200).json({ 
      message: 'Thesis generation workflow initiated successfully.',
      clerk_organization_id: clerk_organization_id,
      triggered_at: triggered_at
    });

  } catch (error) {
    console.error('Error triggering thesis generation:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /clients-theses-need-update
 * Returns list of clients that need their thesis statements updated.
 * 
 * Theses Need Update = TRUE if:
 * - Last Thesis Update > 1 month OR NEVER
 * - Is Public Information Ready = TRUE
 * - Has Active Subscription = TRUE
 * 
 * Used by n8n and admin dashboard.
 */
router.get('/clients-theses-need-update', async (req: Request, res: Response) => {
  const filter = req.query.filter as string | undefined;

  try {
    const client = await pool.connect();

    // 1. Get thesis data from company-service database
    const thesisQuery = `
      SELECT 
        o.clerk_organization_id,
        MAX(oat.updated_at) as last_thesis_update,
        COUNT(oat.id)::integer as thesis_count
      FROM organizations o
      LEFT JOIN organizations_aied_thesis oat ON o.id = oat.organization_id
      WHERE o.clerk_organization_id IS NOT NULL
      GROUP BY o.clerk_organization_id
    `;
    const { rows: thesisRows } = await client.query(thesisQuery);
    client.release();

    // Create thesis lookup map
    const thesisMap = new Map(
      thesisRows.map((row: { clerk_organization_id: string; last_thesis_update: string | null; thesis_count: number }) => 
        [row.clerk_organization_id, { lastUpdate: row.last_thesis_update, count: row.thesis_count }]
      )
    );

    // 2. Get public info status from press-funnel
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

    // 3. Get active subscription status from press-funnel
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

    // Create subscription lookup map
    const subscriptionMap = new Map(
      subscriptionData.map((row: { clerk_organization_id: string; has_active_subscription: boolean; subscription_status: string }) => 
        [row.clerk_organization_id, { hasActive: row.has_active_subscription, status: row.subscription_status }]
      )
    );

    // 4. Get task running status from press-funnel
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
      // Continue without task setup data - is_running will default to false
    }

    // Create task setup lookup map
    const taskSetupMap = new Map(
      taskSetupData.map((row: { clerk_organization_id: string; is_running: boolean }) => 
        [row.clerk_organization_id, { isRunning: row.is_running }]
      )
    );

    // 5. Combine all data
    type ResultRow = {
      client_organization_id: string;
      client_organization_name: string | null;
      client_organization_url: string | null;
      clerk_organization_id: string | null;
      organization_created_at: string;
      is_public_info_ready: boolean;
      public_info_updated_at: string | null;
      last_thesis_update: string | null;
      last_updated_at: string;
      has_active_subscription: boolean;
      subscription_status: string | null;
      is_running: boolean;
      theses_need_update: boolean;
      status_reason: string;
    };

    const results: ResultRow[] = pressFunnelData.map((row: any) => {
      const subscriptionInfo = row.clerk_organization_id 
        ? subscriptionMap.get(row.clerk_organization_id) || { hasActive: false, status: 'Not found' }
        : { hasActive: false, status: 'No clerk_organization_id' };
      
      const thesisData = row.clerk_organization_id 
        ? thesisMap.get(row.clerk_organization_id) || { lastUpdate: null, count: 0 }
        : { lastUpdate: null, count: 0 };
      
      const taskSetupInfo = row.clerk_organization_id 
        ? taskSetupMap.get(row.clerk_organization_id) || { isRunning: false }
        : { isRunning: false };
      
      const isRunning = taskSetupInfo.isRunning;
      
      // Theses need update if:
      // - Has active subscription AND
      // - Public info ready AND
      // - Task NOT running AND
      // - (No theses OR theses > 1 month old)
      const thesesOld = !thesisData.lastUpdate || 
        new Date(thesisData.lastUpdate) < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      const needsUpdate = subscriptionInfo.hasActive && row.is_public_info_ready && !isRunning && thesesOld;

      // Compute status reason
      let statusReason: string;
      if (!subscriptionInfo.hasActive) {
        statusReason = `No active subscription (${subscriptionInfo.status})`;
      } else if (!row.is_public_info_ready) {
        statusReason = 'Public Information not ready';
      } else if (isRunning) {
        statusReason = 'Task currently running';
      } else if (!thesisData.lastUpdate) {
        statusReason = 'No theses created yet';
      } else if (thesesOld) {
        statusReason = 'Theses older than 1 month';
      } else {
        statusReason = 'Updated < 1 month ago';
      }

      // Compute last_updated_at as the most recent date from all sources
      const dates = [
        row.last_updated_at ? new Date(row.last_updated_at) : null,
        thesisData.lastUpdate ? new Date(thesisData.lastUpdate) : null,
        row.public_info_updated_at ? new Date(row.public_info_updated_at) : null,
      ].filter((d): d is Date => d !== null);
      
      const lastUpdatedAt = dates.length > 0 
        ? new Date(Math.max(...dates.map(d => d.getTime()))).toISOString()
        : row.last_updated_at;

      return {
        client_organization_id: row.client_organization_id,
        client_organization_name: row.client_organization_name,
        client_organization_url: row.client_organization_url,
        clerk_organization_id: row.clerk_organization_id,
        organization_created_at: row.organization_created_at,
        is_public_info_ready: row.is_public_info_ready,
        public_info_updated_at: row.public_info_updated_at,
        last_thesis_update: thesisData.lastUpdate,
        last_updated_at: lastUpdatedAt,
        has_active_subscription: subscriptionInfo.hasActive,
        subscription_status: subscriptionInfo.status,
        is_running: isRunning,
        theses_need_update: needsUpdate,
        status_reason: statusReason,
      };
    });

    // Calculate stats
    const stats = {
      total: results.length,
      needUpdate: results.filter((r) => r.theses_need_update).length,
      hasActiveSubscription: results.filter((r) => r.has_active_subscription).length,
      isRunning: results.filter((r) => r.is_running).length,
      publicInfoReady: results.filter((r) => r.is_public_info_ready).length,
    };

    return res.status(200).json({
      organizations: results,
      stats,
    });

  } catch (error) {
    console.error('Error fetching clients theses need update:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /theses-setup
 * Returns thesis setup status for all organizations.
 * Is Setup = TRUE if org has at least one validated thesis.
 * Used by admin dashboard.
 */
router.get('/theses-setup', async (req: Request, res: Response) => {
  try {
    const client = await pool.connect();

    // Get thesis setup status for all organizations
    // Note: 'pending' is deprecated - now we use 'validated' with status_changed_by_type
    const query = `
      SELECT 
        o.clerk_organization_id,
        o.name as organization_name,
        COUNT(oat.id) FILTER (WHERE oat.status = 'validated')::integer as validated_thesis_count,
        COUNT(oat.id) FILTER (WHERE oat.status = 'validated' AND oat.status_changed_by_type = 'user')::integer as user_validated_count,
        COUNT(oat.id) FILTER (WHERE oat.status = 'validated' AND oat.status_changed_by_type = 'ai')::integer as ai_validated_count,
        COUNT(oat.id) FILTER (WHERE oat.status = 'denied')::integer as denied_count,
        MAX(oat.updated_at) as last_updated_at
      FROM organizations o
      LEFT JOIN organizations_aied_thesis oat ON o.id = oat.organization_id
      WHERE o.clerk_organization_id IS NOT NULL
      GROUP BY o.clerk_organization_id, o.name
      ORDER BY MAX(oat.updated_at) DESC NULLS LAST
    `;

    const result = await client.query(query);
    client.release();

    // Transform to setup status
    const organizations = result.rows.map((row: any) => {
      const hasValidated = row.validated_thesis_count > 0;
      const isSetup = hasValidated;

      // Determine status reason
      let statusReason: string;
      if (row.user_validated_count > 0) {
        statusReason = `${row.user_validated_count} user validated`;
      } else if (row.ai_validated_count > 0) {
        statusReason = `${row.ai_validated_count} AI suggested (needs review)`;
      } else if (row.denied_count > 0) {
        statusReason = `${row.denied_count} denied`;
      } else {
        statusReason = 'No thesis';
      }

      return {
        clerk_organization_id: row.clerk_organization_id,
        organization_name: row.organization_name,
        has_thesis: hasValidated,
        validated_count: row.validated_thesis_count,
        user_validated_count: row.user_validated_count,
        ai_validated_count: row.ai_validated_count,
        denied_count: row.denied_count,
        is_setup: isSetup,
        status_reason: statusReason,
        updated_at: row.last_updated_at,
      };
    });

    // Calculate stats
    const stats = {
      total: organizations.length,
      setup: organizations.filter((o: any) => o.is_setup).length,
      notSetup: organizations.filter((o: any) => !o.is_setup).length,
      withUserValidated: organizations.filter((o: any) => o.user_validated_count > 0).length,
      withAiSuggested: organizations.filter((o: any) => o.ai_validated_count > 0 && o.user_validated_count === 0).length,
    };

    return res.status(200).json({ organizations, stats });
  } catch (error) {
    console.error('Error fetching theses setup status:', error);
    return res.status(500).json({ error: 'Failed to fetch theses setup status' });
  }
});

export default router;
