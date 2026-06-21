import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression: x-audience-id cost-attribution plumbing.
 *
 * Guards the four-point contract for per-audience cost attribution:
 *  1. inbound  — requireOrgId reads x-audience-id into req.audienceId
 *  2. egress   — internal-service clients forward it (runs, chat, billing, ...)
 *  3. tagging  — runs-service run creation + cost rows carry audienceId
 *  4. strip    — it is NEVER forwarded to an external vendor (Gemini SDK)
 *
 * Optionality: absent outside the campaign flow → omitted, never thrown.
 */

const AUD = '11111111-1111-1111-1111-111111111111';

// ─── 1. Inbound: requireOrgId → req.audienceId ────────────────────────────────
describe('audience attribution — inbound (requireOrgId)', () => {
  async function run(headers: Record<string, string>) {
    const { requireOrgId } = await import('../../src/middleware/auth');
    const req: any = { headers };
    const res: any = { status: () => res, json: () => res };
    const next = vi.fn();
    requireOrgId(req, res, next);
    return { req, next };
  }

  it('reads x-audience-id into req.audienceId', async () => {
    const { req, next } = await run({ 'x-org-id': 'org_1', 'x-audience-id': AUD });
    expect(req.audienceId).toBe(AUD);
    expect(next).toHaveBeenCalled();
  });

  it('omits audienceId when the header is absent (never throws)', async () => {
    const { req, next } = await run({ 'x-org-id': 'org_1' });
    expect(req.audienceId).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});

// ─── 2 + 3. Egress + tagging: runs-client and chat-client ─────────────────────
describe('audience attribution — internal egress + run/cost tagging', () => {
  const mockFetch = vi.fn();
  process.env.RUNS_SERVICE_URL = 'https://runs-test.example.com';
  process.env.RUNS_SERVICE_API_KEY = 'k';
  process.env.CHAT_SERVICE_URL = 'https://chat-test.example.com';
  process.env.CHAT_SERVICE_API_KEY = 'k';

  beforeEach(() => mockFetch.mockReset());

  function ok(data: unknown) {
    return { ok: true, status: 200, json: () => Promise.resolve(data), text: () => Promise.resolve('{}') };
  }
  async function importFresh(path: string) {
    vi.resetModules();
    vi.stubGlobal('fetch', mockFetch);
    return import(path);
  }

  it('createRun sends x-audience-id header (run tagging)', async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: 'run-1' }));
    const { createRun } = await importFresh('../../src/lib/runs-client');
    await createRun({ orgId: 'org_1', serviceName: 'brand-service', taskName: 'field-extraction', audienceId: AUD });
    expect(mockFetch.mock.calls[0][1].headers['x-audience-id']).toBe(AUD);
  });

  it('createRun omits x-audience-id when none provided', async () => {
    mockFetch.mockResolvedValueOnce(ok({ id: 'run-1' }));
    const { createRun } = await importFresh('../../src/lib/runs-client');
    await createRun({ orgId: 'org_1', serviceName: 'brand-service', taskName: 'field-extraction' });
    expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('x-audience-id');
  });

  it('addCosts forwards x-audience-id header and per-item audienceId (cost row tagging)', async () => {
    mockFetch.mockResolvedValueOnce(ok({ costs: [] }));
    const { addCosts } = await importFresh('../../src/lib/runs-client');
    await addCosts(
      'run-1',
      [{ costName: 'x', quantity: 1, costSource: 'platform', status: 'actual', audienceId: AUD }],
      { orgId: 'org_1', audienceId: AUD },
    );
    expect(mockFetch.mock.calls[0][1].headers['x-audience-id']).toBe(AUD);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.items[0].audienceId).toBe(AUD);
  });

  it('chat() org mode sends x-audience-id to /complete', async () => {
    mockFetch.mockResolvedValueOnce(ok({ content: '{}', tokensInput: 1, tokensOutput: 1, model: 'm' }));
    const { chat } = await importFresh('../../src/lib/chat-client');
    await chat(
      { message: 'm', systemPrompt: 's', provider: 'google', model: 'flash' },
      { mode: 'org', orgId: 'org_1', userId: 'u', runId: 'run-1', audienceId: AUD },
    );
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/complete');
    expect(opts.headers['x-audience-id']).toBe(AUD);
  });
});

// ─── 4. Egress strip: internal forward, vendor receives nothing ───────────────
describe('audience attribution — external egress strip (Gemini)', () => {
  const axiosGet = vi.fn();
  const generateContent = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    axiosGet.mockReset();
    generateContent.mockReset();
  });

  it('forwards x-audience-id to press-funnel (internal) but NEVER to the Gemini SDK (vendor)', async () => {
    process.env.GEMINI_API_KEY = 'k';
    process.env.PRESS_FUNNEL_SERVICE_URL = 'https://press-test.example.com';
    process.env.PRESS_FUNNEL_API_KEY = 'k';

    // db import throws without a DB url in unit env — stub it.
    vi.doMock('../../src/db', () => ({ db: {}, mediaAssets: {} }));
    vi.doMock('axios', () => ({ default: { get: axiosGet } }));
    vi.doMock('@google/generative-ai', () => ({
      GoogleGenerativeAI: class {
        getGenerativeModel() { return { generateContent }; }
      },
    }));

    axiosGet.mockResolvedValueOnce({ data: { id: 'o', name: 'Acme', url: 'a', private_information: '' } });
    generateContent.mockResolvedValueOnce({ response: { text: () => '{"caption":"c","altText":"a"}' } });

    const { analyzeImageWithGemini } = await import('../../src/services/geminiAnalysisService');
    await analyzeImageWithGemini(Buffer.from('x'), 'image/jpeg', 'f.jpg', 'ext-org', {
      orgId: 'org_1',
      audienceId: AUD,
    });

    // Internal sibling (press-funnel) — header forwarded.
    expect(axiosGet.mock.calls[0][1].headers['x-audience-id']).toBe(AUD);

    // Vendor (Gemini SDK) — no header surface at all; assert the audience id never
    // appears anywhere in the arguments passed to the model.
    expect(generateContent).toHaveBeenCalled();
    expect(JSON.stringify(generateContent.mock.calls)).not.toContain(AUD);
  });
});
