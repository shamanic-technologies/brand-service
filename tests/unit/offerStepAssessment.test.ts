import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  STEP_PRESENT_THRESHOLD,
  buildAssessmentState,
  buildStepQuestions,
  stepsFromAnswers,
} from '../../src/lib/offer-step-assessment';
import { judgeNouls } from '../../src/lib/chat-client';

/**
 * EVERY OFFER KNOWS ITS SALES STEPS (owner 2026-10-18, CeXO): the pure half of
 * the assessment, and the Jev client it rides on.
 */
const CATALOGUE = [
  { key: 'conversation', name: 'Positive reply' },
  { key: 'meeting_booked', name: 'Meeting booked' },
  { key: 'purchase', name: 'Direct purchase' },
  { key: 'a_step_added_tomorrow', name: 'Something new' },
];

describe('offer step assessment', () => {
  it('asks one yes/no per catalogue step AS SERVED, never a hand-kept list', () => {
    const questions = buildStepQuestions(CATALOGUE);
    expect(Object.keys(questions)).toEqual(CATALOGUE.map((s) => s.key));
    for (const step of CATALOGUE) {
      expect(questions[step.key].type).toBe('noul');
      expect(questions[step.key].instructions).toContain(`"${step.name}"`);
    }
  });

  it('keeps the steps judged present, in catalogue order (CeXO: no Direct purchase)', () => {
    const steps = stepsFromAnswers(CATALOGUE, {
      a_step_added_tomorrow: STEP_PRESENT_THRESHOLD,
      purchase: 0.03,
      meeting_booked: 0.95,
      conversation: 0.9,
    });
    expect(steps).toEqual(['conversation', 'meeting_booked', 'a_step_added_tomorrow']);
  });

  it('states what we know of the offer, and omits what we do not know', () => {
    const bare = buildAssessmentState({
      brandName: 'CeXO',
      brandDomain: 'cexoai.com',
      offerName: 'CeXO AI',
      offerDescription: 'Executive scorecards for AI spend for CXOs.',
      lifetimeRevenueUsd: 12000,
      confirmedFields: {},
      websiteFields: {},
      answers: [],
    });
    expect(bare).toEqual({
      seller: { name: 'CeXO', website: 'cexoai.com' },
      offer: { name: 'CeXO AI', description: 'Executive scorecards for AI spend for CXOs.', valueOfOneClientUsd: 12000 },
    });

    const rich = buildAssessmentState({
      brandName: 'CeXO',
      brandDomain: null,
      offerName: 'CeXO AI',
      offerDescription: null,
      lifetimeRevenueUsd: null,
      confirmedFields: { services: ['Scorecards'] },
      websiteFields: { urgency: 'Budgets close in Q4' },
      answers: [{ question: 'How much?', answer: '$12k a year' }],
    });
    expect(rich).toMatchObject({
      confirmedByTheClient: { services: ['Scorecards'] },
      readOffTheSellersWebsite: { urgency: 'Budgets close in Q4' },
      clientAnswersToBuyerQuestions: [{ question: 'How much?', answer: '$12k a year' }],
    });
  });
});

describe('judgeNouls', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const questions = buildStepQuestions(CATALOGUE.slice(0, 2));

  const support = { kind: 'brand_setup' as const, reason: 'no run of ours' };

  it('platform-billed: /internal/platform-judgments, no org headers, the declared support in the body', async () => {
    const fetchMock = stubFetch({ answers: { conversation: { type: 'noul', noul: 0.9 }, meeting_booked: { type: 'noul', noul: 0.2 } } });
    const out = await judgeNouls({ offer: 'x' }, questions, { mode: 'platform', support });
    expect(out).toEqual({ conversation: 0.9, meeting_booked: 0.2 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/internal\/platform-judgments$/);
    expect(init.headers['x-org-id']).toBeUndefined();
    expect(init.headers['x-run-id']).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ state: { offer: 'x' }, questions, support });
  });

  it('platform-billed with a caller run: x-run-id, no support', async () => {
    const fetchMock = stubFetch({ answers: { conversation: { type: 'noul', noul: 0.9 }, meeting_booked: { type: 'noul', noul: 0.2 } } });
    await judgeNouls('s', questions, { mode: 'platform', runId: 'run-1' });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['x-run-id']).toBe('run-1');
    expect(JSON.parse(init.body).support).toBeUndefined();
  });

  it('org-billed: /orgs/judgments with the org identity', async () => {
    const fetchMock = stubFetch({ answers: { conversation: { type: 'noul', noul: 0.9 }, meeting_booked: { type: 'noul', noul: 0.6 } } });
    await judgeNouls('s', questions, { mode: 'org', orgId: 'o', userId: 'u', runId: 'r' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/orgs\/judgments$/);
    expect(init.headers).toMatchObject({ 'x-org-id': 'o', 'x-user-id': 'u', 'x-run-id': 'r' });
  });

  it('throws when a question comes back without a probability', async () => {
    stubFetch({ answers: { conversation: { type: 'noul', noul: 0.9 } } });
    await expect(judgeNouls('s', questions, { mode: 'platform', support })).rejects.toThrow(/meeting_booked/);
  });
});
