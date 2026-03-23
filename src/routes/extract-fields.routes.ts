import { Router, Request, Response } from 'express';
import { extractFields, getBrand } from '../services/fieldExtractionService';
import { SiteMapError } from '../lib/scraping-client';
import { ExtractFieldsRequestSchema } from '../schemas';

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /brands/:brandId/extract-fields
 *
 * Generic field extraction endpoint. Clients send a list of fields with
 * key + description; the service returns extracted values (cached or fresh).
 */
router.post('/brands/:brandId/extract-fields', async (req: Request, res: Response) => {
  try {
    const { brandId } = req.params;
    if (!UUID_REGEX.test(brandId)) {
      return res.status(400).json({ error: 'Invalid brandId format: must be a UUID' });
    }

    const parsed = ExtractFieldsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const brand = await getBrand(brandId);
    if (!brand) {
      return res.status(404).json({ error: 'Brand not found' });
    }
    if (!brand.url) {
      return res.status(400).json({
        error: 'Brand has no URL',
        hint: 'Use POST /brands to register a brand with a URL first.',
      });
    }

    const results = await extractFields({
      brandId,
      fields: parsed.data.fields,
      orgId: req.orgId,
      userId: req.userId,
      parentRunId: req.runId!,
      campaignId: req.campaignId,
      brandIdHeader: req.brandIdHeader,
      workflowName: req.workflowName,
    });

    return res.json({ brandId, results });
  } catch (error: any) {
    console.error('Extract fields error:', error);
    if (error instanceof SiteMapError) {
      return res.status(422).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Failed to extract fields' });
  }
});

export default router;
