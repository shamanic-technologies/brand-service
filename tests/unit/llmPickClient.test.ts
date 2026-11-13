import { describe, it, expect, vi, afterEach } from 'vitest';
import { pickLlm, LlmPickUnavailableError } from '../../src/lib/llm-pick-client';
import { pickOfferFieldsLlm, suggestModelParams, OFFER_FIELDS_OUTCOME } from '../../src/lib/offer-fields-llm';

/**
 * OFFER-FIELDS-NO-OPUS-1112: the offer-field suggestion asks the GTM Factory Rating (features-service
 * `GET /internal/llm-pick`) which LLM to use. No model is named in code and nothing falls back to one.
 */
const fetchMock = vi.fn();

function answer(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const PICK = {
  outcome: 'offer_fields_drafted',
  place: 'draft',
  llm: { llmDynastySlug: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', provider: 'deepseek', model: 'deepseek-flash' },
  candidates: ['claude-sonnet', 'deepseek-flash', 'gemini-flash'],
  evidenceComputedAt: null,
  evidenceUnavailableReason: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('pickLlm — the Rating names the LLM', () => {
  it('asks /internal/llm-pick with the outcome, the place and our run, and returns provider + dynasty slug', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(answer(200, PICK));
    const picked = await pickLlm({ outcome: 'offer_fields_drafted', place: 'draft', runId: 'run-1', campaignId: 'camp-1' });
    expect(picked).toEqual({ provider: 'deepseek', model: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/internal\/llm-pick\?outcome=offer_fields_drafted&place=draft&campaignId=camp-1$/);
    expect(init.headers['x-run-id']).toBe('run-1');
    expect(init.headers).toHaveProperty('x-api-key');
  });

  it('sends no x-run-id when no run of ours stands behind the call', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(answer(200, PICK));
    await pickLlm({ outcome: 'offer_fields_drafted', place: 'consolidate' });
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('x-run-id');
  });

  it('a 422 no_llm_in_engine_universe throws (no default model)', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(answer(422, { reason: 'no_llm_in_engine_universe' }));
    await expect(pickLlm({ outcome: 'offer_fields_drafted', place: 'draft' })).rejects.toBeInstanceOf(LlmPickUnavailableError);
  });

  it('an unreachable Rating throws', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(pickLlm({ outcome: 'offer_fields_drafted', place: 'draft' })).rejects.toThrow('ECONNREFUSED');
  });

  it('a provider chat-service does not serve, or no model, throws', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(answer(200, { llm: { provider: null, model: 'x' } }));
    await expect(pickLlm({ outcome: 'o', place: 'p' })).rejects.toBeInstanceOf(LlmPickUnavailableError);
    fetchMock.mockResolvedValueOnce(answer(200, { llm: { provider: 'google', model: '' } }));
    await expect(pickLlm({ outcome: 'o', place: 'p' })).rejects.toBeInstanceOf(LlmPickUnavailableError);
    fetchMock.mockResolvedValueOnce(answer(200, 'not json'));
    await expect(pickLlm({ outcome: 'o', place: 'p' })).rejects.toBeInstanceOf(LlmPickUnavailableError);
  });
});

describe('pickOfferFieldsLlm — the offer-field draft is the « Offer fields drafted » Engine', () => {
  it('org caller: our run + the campaign travel with the pick', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(answer(200, PICK));
    await pickOfferFieldsLlm({ mode: 'org', orgId: 'o', userId: 'u', runId: 'our-run', campaignId: 'c' }, 'draft');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(`outcome=${OFFER_FIELDS_OUTCOME}&place=draft&campaignId=c`);
    expect(init.headers['x-run-id']).toBe('our-run');
  });

  it('a brand-field draft asks the Rating for ITS Engine (SCRIPT-VALUE-RATING-1113)', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(answer(200, PICK));
    await pickOfferFieldsLlm({ mode: 'org', orgId: 'o', userId: 'u', runId: 'our-run' }, 'draft', 'brand_fields_drafted');
    expect(fetchMock.mock.calls[0][0]).toContain('outcome=brand_fields_drafted&place=draft');
  });

  it('suggestModelParams carries only what the Rating named + the output budget', () => {
    expect(suggestModelParams({ provider: 'google', model: 'gemini-flash', name: 'Gemini' })).toEqual({
      provider: 'google',
      model: 'gemini-flash',
      maxTokens: 24000,
    });
  });
});
