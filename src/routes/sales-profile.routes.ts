import { Router, Request, Response } from 'express';
import {
  extractOrganizationSalesProfile,
  getExistingSalesProfile,
  getOrganization,
} from '../services/salesProfileExtractionService';

const router = Router();

/**
 * POST /organizations/:organizationId/extract-sales-profile
 * Extract sales profile from organization's website using AI
 */
router.post(
  '/organizations/:organizationId/extract-sales-profile',
  async (req: Request, res: Response) => {
    try {
      const { organizationId } = req.params;
      const { anthropicApiKey, skipCache, forceRescrape } = req.body;

      if (!anthropicApiKey) {
        return res.status(400).json({ error: 'anthropicApiKey is required (BYOK)' });
      }

      if (!organizationId) {
        return res.status(400).json({ error: 'organizationId is required' });
      }

      // Verify organization exists
      const org = await getOrganization(organizationId);
      if (!org) {
        return res.status(404).json({ error: 'Organization not found' });
      }

      // Extract sales profile
      const result = await extractOrganizationSalesProfile(
        organizationId,
        anthropicApiKey,
        { skipCache, forceRescrape }
      );

      res.json(result);
    } catch (error: any) {
      console.error('Extract sales profile error:', error);
      res.status(500).json({ error: error.message || 'Failed to extract sales profile' });
    }
  }
);

/**
 * GET /organizations/:organizationId/sales-profile
 * Get existing sales profile for an organization
 */
router.get(
  '/organizations/:organizationId/sales-profile',
  async (req: Request, res: Response) => {
    try {
      const { organizationId } = req.params;

      if (!organizationId) {
        return res.status(400).json({ error: 'organizationId is required' });
      }

      const profile = await getExistingSalesProfile(organizationId);

      if (!profile) {
        return res.status(404).json({ error: 'Sales profile not found' });
      }

      res.json({ profile });
    } catch (error: any) {
      console.error('Get sales profile error:', error);
      res.status(500).json({ error: error.message || 'Failed to get sales profile' });
    }
  }
);

export default router;
