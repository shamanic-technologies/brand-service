import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * SCRIPT-VALUE-RATING-1113-WF3: a field draft asks its Engine for the Unit (workflow-service
 * `POST /internal/engines/{outcome}/make`): the Rating picks the script, the script writes on its own run (a child of
 * ours). brand-service names no LLM and has no fallback: anything but a made draft fails loud.
 */

const mockFetch = vi.fn();
process.env.WORKFLOW_SERVICE_URL = 'http://workflow.test';
process.env.WORKFLOW_SERVICE_API_KEY = 'wf-key';

async function importClient() {
  vi.resetModules();
  vi.stubGlobal('fetch', mockFetch);
  return import('../../src/lib/engine-make-client');
}

const calls = [
  { place: 'draft' as const, systemPrompt: 'sys', message: 'msg 1', responseFormat: 'json' as const, maxTokens: 24000 },
  { place: 'draft' as const, systemPrompt: 'sys', message: 'msg 2', responseFormat: 'json' as const, maxTokens: 24000 },
];
const identity = { runId: 'our-run', orgId: 'org-1', userId: 'user-1', campaignId: 'camp-1' };

function answer(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) };
}

const made = {
  scriptId: 's-1',
  scriptSlug: 'script:offer_fields_drafted/dy_fields_draft__gemini_pro',
  version: 1,
  runId: 'script-run',
  status: 'made',
  unit: {
    outcome: 'offer_fields_drafted',
    subject: { service: 'brand-service', id: 'offer-1' },
    content: {
      answers: [
        { place: 'draft', json: { a: '1' }, content: '{"a":"1"}', model: 'gemini-pro' },
        { place: 'draft', json: null, content: 'Here: {"b":"2"}', model: 'gemini-pro' },
      ],
    },
  },
  error: null,
  vendorCalls: [],
  declared: { produced: [], consumed: [] },
  pick: { outcome: 'offer_fields_drafted', dynasty: 'dy_fields_draft__gemini_pro', version: 1 },
};

describe('makeFieldsDraft', () => {
  beforeEach(() => mockFetch.mockReset());

  it('asks the Engine with our run as parent, the draft request as material, recorded by brand, no LLM named', async () => {
    const { makeFieldsDraft } = await importClient();
    mockFetch.mockResolvedValueOnce(answer(200, made));
    const out = await makeFieldsDraft({
      outcome: 'offer_fields_drafted',
      calls,
      identity,
      billing: 'org',
      subject: { service: 'brand-service', id: 'offer-1' },
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://workflow.test/internal/engines/offer_fields_drafted/make');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'x-api-key': 'wf-key',
      'x-run-id': 'our-run',
      'x-org-id': 'org-1',
      'x-user-id': 'user-1',
      'x-campaign-id': 'camp-1',
    });
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      units: { draft_request: { content: { calls }, subject: { service: 'brand-service', id: 'offer-1' } } },
      recordedBy: 'brand',
      billing: 'org',
      subject: { service: 'brand-service', id: 'offer-1' },
    });
    expect(JSON.stringify(body)).not.toMatch(/"provider"|"model"/);
    expect(out.scriptRunId).toBe('script-run');
    expect(out.answers).toHaveLength(2);
  });

  it('answers parse as a chat answer did: structured JSON, else the object in the text', async () => {
    const { makeFieldsDraft, answerJson } = await importClient();
    mockFetch.mockResolvedValueOnce(answer(200, made));
    const out = await makeFieldsDraft({ outcome: 'offer_fields_drafted', calls, identity, billing: 'org' });
    expect(Object.assign({}, ...out.answers.map(answerJson))).toEqual({ a: '1', b: '2' });
  });

  it.each([
    [404, { code: 'no_runnable_script', error: 'no script' }, 'no_runnable_script'],
    [502, { code: 'script_pick_unreadable', error: 'features down' }, 'script_pick_unreadable'],
    [502, { error: 'script failed: chat 500' }, 'script failed'],
  ])('HTTP %i fails loud (EngineMakeUnavailableError), never a fallback', async (status, body, text) => {
    const { makeFieldsDraft, EngineMakeUnavailableError } = await importClient();
    mockFetch.mockResolvedValueOnce(answer(status, body));
    const p = makeFieldsDraft({ outcome: 'offer_fields_drafted', calls, identity, billing: 'org' });
    await expect(p).rejects.toBeInstanceOf(EngineMakeUnavailableError);
    await expect(p).rejects.toThrow(text);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('a script that failed on the org\'s credit reads as the fleet\'s 402', async () => {
    const { makeFieldsDraft } = await importClient();
    const { isInsufficientCredits } = await import('../../src/lib/insufficient-credits');
    mockFetch.mockResolvedValueOnce(answer(502, { error: 'script failed: chat-service returned 402: Insufficient credits' }));
    const err = await makeFieldsDraft({ outcome: 'offer_fields_drafted', calls, identity, billing: 'org' }).catch((e) => e);
    expect(isInsufficientCredits(err)).toBe(true);
  });

  it('unreachable, a non-made status, or a wrong answer count fail loud', async () => {
    const { makeFieldsDraft, EngineMakeUnavailableError } = await importClient();
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(makeFieldsDraft({ outcome: 'o', calls, identity, billing: 'org' })).rejects.toBeInstanceOf(EngineMakeUnavailableError);

    mockFetch.mockResolvedValueOnce(answer(200, { ...made, status: 'unmade' }));
    await expect(makeFieldsDraft({ outcome: 'o', calls, identity, billing: 'org' })).rejects.toThrow('status');

    mockFetch.mockResolvedValueOnce(answer(200, { ...made, unit: { ...made.unit, content: { answers: [made.unit.content.answers[0]] } } }));
    await expect(makeFieldsDraft({ outcome: 'o', calls, identity, billing: 'org' })).rejects.toThrow('1 answers for 2 calls');
  });
});
