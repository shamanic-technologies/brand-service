import express, { Router, Request, Response } from 'express';
import {
  CompanyBatchRequestSchema,
  CompanyFactsWriteRequestSchema,
  CompanyResolveRequestSchema,
} from '../schemas';
import {
  CompanyFactsValidationError,
  UnknownCompanyError,
  getCompanies,
  resolveCompanies,
  writeCompanyFacts,
} from '../services/companyService';

/**
 * The company a LEAD works at (owner 2026-10-13). Internal, service auth, no
 * org: a prospect's company is nobody's client. See `companyService`.
 */
export const internalRouter = Router();

/**
 * A 1000-company facts write (descriptions, keyword lists) exceeds the app's
 * 2mb default. Mounted BEFORE the global json parser for this prefix only.
 */
export const companiesBodyParser = express.json({ limit: '10mb' });

internalRouter.post('/companies/resolve', async (req: Request, res: Response) => {
  const parsed = CompanyResolveRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  try {
    const companies = await resolveCompanies(parsed.data.companies);
    res.json({ companies });
  } catch (error: any) {
    console.error('[brand-service] companies resolve error:', error);
    res.status(500).json({ error: error?.message || 'Failed to resolve companies' });
  }
});

internalRouter.put('/companies/facts', async (req: Request, res: Response) => {
  const parsed = CompanyFactsWriteRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  try {
    const result = await writeCompanyFacts(parsed.data.companies);
    res.json(result);
  } catch (error: any) {
    if (error instanceof CompanyFactsValidationError) {
      return res.status(400).json({ error: 'Invalid company facts', problems: error.problems });
    }
    if (error instanceof UnknownCompanyError) {
      return res.status(404).json({ error: 'Unknown brand ids', brandIds: error.brandIds });
    }
    console.error('[brand-service] companies facts write error:', error);
    res.status(500).json({ error: error?.message || 'Failed to write company facts' });
  }
});

internalRouter.post('/companies/batch', async (req: Request, res: Response) => {
  const parsed = CompanyBatchRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  try {
    const companies = await getCompanies(parsed.data.brandIds);
    res.json({ companies });
  } catch (error: any) {
    console.error('[brand-service] companies batch read error:', error);
    res.status(500).json({ error: error?.message || 'Failed to read companies' });
  }
});
