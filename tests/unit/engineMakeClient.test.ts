import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * SCRIPT-VALUE-RATING-1113-WF3: a field draft asks its Engine for the Unit (workflow-service
 * `POST /internal/engines/{outcome}/make`): the Rating picks the script, the script writes on its own run (a child of
 * ours). brand-service names no LLM and has no fallback: anything but a made draft fails loud.
 */

// A real local workflow-service stand-in: the client posts over node:http (no 300 s fetch header cutoff).
type Seen = { url: string; method: string; headers: http.IncomingHttpHeaders; body: string };
const seen: Seen[] = [];
let reply: (req: Seen) => { status: number; body: unknown } | 'hang' = () => ({ status: 500, body: {} });
const sent = { mock: { get calls() { return seen.map((r) => [`http://workflow.test${r.url}`, { method: r.method, headers: r.headers, body: r.body }]); } } };
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const r: Seen = { url: req.url ?? '', method: req.method ?? '', headers: req.headers, body };
      seen.push(r);
      const a = reply(r);
      if (a === 'hang') return;
      res.writeHead(a.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(a.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.WORKFLOW_SERVICE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.WORKFLOW_SERVICE_API_KEY = 'wf-key';
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function importClient() {
  vi.resetModules();
  return import('../../src/lib/engine-make-client');
}

const calls = [
  { place: 'draft' as const, systemPrompt: 'sys', message: 'msg 1', responseFormat: 'json' as const, maxTokens: 24000 },
  { place: 'draft' as const, systemPrompt: 'sys', message: 'msg 2', responseFormat: 'json' as const, maxTokens: 24000 },
];
const identity = { runId: 'our-run', orgId: 'org-1', userId: 'user-1', campaignId: 'camp-1' };

function answer(status: number, body: unknown) {
  return { status, body };
}
const once = (a: { status: number; body: unknown }) => { reply = () => a; };

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
  beforeEach(() => { seen.length = 0; });

  it('asks the Engine with our run as parent, the draft request as material, recorded by brand, no LLM named', async () => {
    const { makeFieldsDraft } = await importClient();
    once(answer(200, made));
    const out = await makeFieldsDraft({
      outcome: 'offer_fields_drafted',
      calls,
      identity,
      billing: 'org',
      subject: { service: 'brand-service', id: 'offer-1' },
    });

    const [url, init] = sent.mock.calls[0];
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
    once(answer(200, made));
    const out = await makeFieldsDraft({ outcome: 'offer_fields_drafted', calls, identity, billing: 'org' });
    expect(Object.assign({}, ...out.answers.map(answerJson))).toEqual({ a: '1', b: '2' });
  });

  it.each([
    [404, { code: 'no_runnable_script', error: 'no script' }, 'no_runnable_script'],
    [502, { code: 'script_pick_unreadable', error: 'features down' }, 'script_pick_unreadable'],
    [502, { error: 'script failed: chat 500' }, 'script failed'],
  ])('HTTP %i fails loud (EngineMakeUnavailableError), never a fallback', async (status, body, text) => {
    const { makeFieldsDraft, EngineMakeUnavailableError } = await importClient();
    once(answer(status, body));
    const p = makeFieldsDraft({ outcome: 'offer_fields_drafted', calls, identity, billing: 'org' });
    await expect(p).rejects.toBeInstanceOf(EngineMakeUnavailableError);
    await expect(p).rejects.toThrow(text);
    expect(seen).toHaveLength(1);
  });

  it('a script that failed on the org\'s credit reads as the fleet\'s 402', async () => {
    const { makeFieldsDraft } = await importClient();
    const { isInsufficientCredits } = await import('../../src/lib/insufficient-credits');
    once(answer(502, { error: 'script failed: chat-service returned 402: Insufficient credits' }));
    const err = await makeFieldsDraft({ outcome: 'offer_fields_drafted', calls, identity, billing: 'org' }).catch((e) => e);
    expect(isInsufficientCredits(err)).toBe(true);
  });

  it('unreachable, a non-made status, or a wrong answer count fail loud', async () => {
    const { makeFieldsDraft, EngineMakeUnavailableError } = await importClient();
    const url = process.env.WORKFLOW_SERVICE_URL;
    process.env.WORKFLOW_SERVICE_URL = 'http://127.0.0.1:1';
    const { makeFieldsDraft: closed } = await importClient();
    await expect(closed({ outcome: 'o', calls, identity, billing: 'org' })).rejects.toThrow('workflow-service unreachable');
    process.env.WORKFLOW_SERVICE_URL = url;

    once(answer(200, { ...made, status: 'unmade' }));
    await expect(makeFieldsDraft({ outcome: 'o', calls, identity, billing: 'org' })).rejects.toThrow('status');

    once(answer(200, { ...made, unit: { ...made.unit, content: { answers: [made.unit.content.answers[0]] } } }));
    await expect(makeFieldsDraft({ outcome: 'o', calls, identity, billing: 'org' })).rejects.toThrow('1 answers for 2 calls');
  });

  it('waits past Node fetch\'s 300 s header cutoff: the deadline is ours (15 min)', async () => {
    const { MAKE_TIMEOUT_MS } = await importClient();
    expect(MAKE_TIMEOUT_MS).toBeGreaterThan(300_000);
  });
});
