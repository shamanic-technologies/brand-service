import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, getAuthHeaders, getInternalAuthHeaders } from '../helpers/test-app';
import { db, brands, orgBrands, brandSalesFunnels, brandSalesFunnelDeclarations } from '../../src/db';
import { inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';

/**
 * The funnels a brand declares it sells through, and each one's own economics.
 *
 * The end-to-end proof is the merged dashboard Sales Funnels card: it renders
 * four funnels with per-funnel rates, per-funnel lifetime revenue, a per-funnel
 * landing page and a booking link, and had nowhere to save any of it. Everything
 * that card shows must round-trip here — including the meeting show-up rate,
 * which is stored nowhere else in the fleet.
 */
describe('Sales Funnels Endpoints', () => {
  const app = createTestApp();

  const ownerOrgId = randomUUID();
  const otherOrgId = randomUUID();
  const brandId = randomUUID(); // owned by ownerOrgId, has a website
  const noWebsiteBrandId = randomUUID(); // owned by ownerOrgId, no url/domain
  const foreignBrandId = randomUUID(); // owned by otherOrgId
  const unknownBrandId = randomUUID(); // not in brands at all

  const dom = (id: string) => `funnels-${id.slice(0, 8)}.com`;
  const allBrandIds = [brandId, noWebsiteBrandId, foreignBrandId];

  beforeAll(async () => {
    await db.insert(brands).values([
      { id: brandId, url: `https://${dom(brandId)}`, domain: dom(brandId), name: 'Funnel Brand' },
      { id: noWebsiteBrandId, name: 'No Website Funnel Brand' },
      {
        id: foreignBrandId,
        url: `https://${dom(foreignBrandId)}`,
        domain: dom(foreignBrandId),
        name: 'Foreign Funnel Brand',
      },
    ]);
    await db.insert(orgBrands).values([
      { orgId: ownerOrgId, brandId },
      { orgId: ownerOrgId, brandId: noWebsiteBrandId },
      { orgId: otherOrgId, brandId: foreignBrandId },
    ]);
  });

  afterAll(async () => {
    // One statement per table whatever the brand count — a per-brand loop is
    // three round-trips per brand and blows the hook budget on a cold branch.
    await db.delete(brandSalesFunnels).where(inArray(brandSalesFunnels.brandId, allBrandIds));
    await db
      .delete(brandSalesFunnelDeclarations)
      .where(inArray(brandSalesFunnelDeclarations.brandId, allBrandIds));
    await db.delete(orgBrands).where(inArray(orgBrands.brandId, allBrandIds));
    await db.delete(brands).where(inArray(brands.id, allBrandIds));
  });

  const list = (id: string) => `/orgs/brands/${id}/sales-funnels`;
  const one = (id: string, key: string) => `/orgs/brands/${id}/sales-funnels/${key}`;

  // AC1 + AC4 — a brand can declare the set it sells through and read it back
  // unchanged, and "never said anything" is distinguishable from "said none".
  it('starts undeclared — an empty list that means unknown, not "sells through nothing"', async () => {
    const res = await request(app).get(list(brandId)).set(getAuthHeaders(ownerOrgId));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ declared: false, funnels: [] });
  });

  it('declares a funnel and reads the set back', async () => {
    const put = await request(app)
      .put(one(brandId, 'visit_signup'))
      .set(getAuthHeaders(ownerOrgId))
      .send({
        rates: { visitToSignupPct: 30, signupToPaidClientPct: 12.5 },
        lifetimeRevenueUsd: 4200,
        destinationUrl: `https://${dom(brandId)}/pricing`,
      });

    expect(put.status).toBe(200);
    expect(put.body.funnel.funnelKey).toBe('visit_signup');
    expect(put.body.funnel.rates).toEqual({ visitToSignupPct: 30, signupToPaidClientPct: 12.5 });
    expect(put.body.funnel.lifetimeRevenueUsd).toBe(4200);
    expect(put.body.funnel.destinationUrl).toBe(`https://${dom(brandId)}/pricing`);

    const res = await request(app).get(list(brandId)).set(getAuthHeaders(ownerOrgId));
    expect(res.status).toBe(200);
    expect(res.body.funnels.map((f: any) => f.funnelKey)).toEqual(['visit_signup']);
    // Declaring a funnel IS stating that the set includes it.
    expect(res.body.declared).toBe(true);
  });

  // AC3 — every arrow the dashboard renders has somewhere to be stored, incl.
  // the meeting show-up rate, which exists on no other table in the fleet.
  it('stores the meeting show-up rate and the booking link', async () => {
    const res = await request(app)
      .put(one(brandId, 'reply_meeting'))
      .set(getAuthHeaders(ownerOrgId))
      .send({
        rates: { replyToMeetingPct: 40, meetingBookedToAttendedPct: 70, meetingToClosePct: 25 },
        lifetimeRevenueUsd: 18000,
        bookingUrl: 'https://cal.com/funnel-team/30min',
      });

    expect(res.status).toBe(200);
    expect(res.body.funnel.rates).toEqual({
      replyToMeetingPct: 40,
      meetingBookedToAttendedPct: 70,
      meetingToClosePct: 25,
    });
    expect(res.body.funnel.bookingUrl).toBe('https://cal.com/funnel-team/30min');
  });

  // AC2 — each funnel's economics are readable and writable independently
  it('keeps two funnels of one brand priced independently', async () => {
    const res = await request(app).get(list(brandId)).set(getAuthHeaders(ownerOrgId));

    expect(res.status).toBe(200);
    // Catalogue order, not insertion order.
    expect(res.body.funnels.map((f: any) => f.funnelKey)).toEqual([
      'reply_meeting',
      'visit_signup',
    ]);
    const [meeting, signup] = res.body.funnels;
    expect(meeting.lifetimeRevenueUsd).toBe(18000);
    expect(signup.lifetimeRevenueUsd).toBe(4200);
    expect(meeting.rates).not.toHaveProperty('visitToSignupPct');
    expect(signup.rates).not.toHaveProperty('meetingBookedToAttendedPct');
  });

  it('writing one funnel leaves the other untouched', async () => {
    await request(app)
      .put(one(brandId, 'visit_signup'))
      .set(getAuthHeaders(ownerOrgId))
      .send({ lifetimeRevenueUsd: 5000 });

    const res = await request(app).get(list(brandId)).set(getAuthHeaders(ownerOrgId));
    const byKey = Object.fromEntries(res.body.funnels.map((f: any) => [f.funnelKey, f]));
    expect(byKey.visit_signup.lifetimeRevenueUsd).toBe(5000);
    // Omitted here, so still exactly what the earlier write left.
    expect(byKey.visit_signup.rates.visitToSignupPct).toBe(30);
    expect(byKey.reply_meeting.lifetimeRevenueUsd).toBe(18000);
  });

  // AC4 — declared and never-set are different answers
  it('reports a rate the brand never gave us as null', async () => {
    const res = await request(app)
      .put(one(brandId, 'visit_form'))
      .set(getAuthHeaders(ownerOrgId))
      .send({ rates: { visitToFormSubmissionPct: 8 } });

    expect(res.status).toBe(200);
    expect(res.body.funnel.rates).toEqual({
      visitToFormSubmissionPct: 8,
      formSubmissionToPaidClientPct: null,
    });
    expect(res.body.funnel.lifetimeRevenueUsd).toBeNull();
    expect(res.body.funnel.destinationUrl).toBeNull();
  });

  it('an explicit null takes a declared value back', async () => {
    const res = await request(app)
      .put(one(brandId, 'visit_form'))
      .set(getAuthHeaders(ownerOrgId))
      .send({ rates: { visitToFormSubmissionPct: null } });

    expect(res.status).toBe(200);
    expect(res.body.funnel.rates.visitToFormSubmissionPct).toBeNull();
  });

  it('declares a funnel with nothing priced yet', async () => {
    const res = await request(app)
      .put(one(brandId, 'visit_meeting'))
      .set(getAuthHeaders(ownerOrgId))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.funnel.funnelKey).toBe('visit_meeting');
    expect(Object.values(res.body.funnel.rates).every((v) => v === null)).toBe(true);
  });

  it('carries the canonical goal on both fields', async () => {
    const res = await request(app).get(list(brandId)).set(getAuthHeaders(ownerOrgId));
    const byKey = Object.fromEntries(res.body.funnels.map((f: any) => [f.funnelKey, f]));
    expect(byKey.reply_meeting.goal).toBe('meetingBooked');
    expect(byKey.reply_meeting.currentGoal).toBe('meetingBooked');
    expect(byKey.visit_form.goal).toBe('formSubmission');
    expect(byKey.visit_form.currentGoal).toBe('formSubmission');
  });

  // Undeclaring
  it('undeclares a funnel and returns the set that is left', async () => {
    const res = await request(app)
      .delete(one(brandId, 'visit_meeting'))
      .set(getAuthHeaders(ownerOrgId));

    expect(res.status).toBe(200);
    expect(res.body.funnels.map((f: any) => f.funnelKey)).toEqual([
      'reply_meeting',
      'visit_signup',
      'visit_form',
    ]);
  });

  it('undeclaring a funnel that was never declared is a no-op, not an error', async () => {
    const res = await request(app)
      .delete(one(brandId, 'visit_meeting'))
      .set(getAuthHeaders(ownerOrgId));

    expect(res.status).toBe(200);
    expect(res.body.funnels.map((f: any) => f.funnelKey)).not.toContain('visit_meeting');
  });

  it('re-declaring after undeclaring starts from nothing, not from the old numbers', async () => {
    await request(app)
      .put(one(brandId, 'visit_meeting'))
      .set(getAuthHeaders(ownerOrgId))
      .send({ rates: { meetingToClosePct: 33 } });
    await request(app).delete(one(brandId, 'visit_meeting')).set(getAuthHeaders(ownerOrgId));

    const res = await request(app)
      .put(one(brandId, 'visit_meeting'))
      .set(getAuthHeaders(ownerOrgId))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.funnel.rates.meetingToClosePct).toBeNull();

    await request(app).delete(one(brandId, 'visit_meeting')).set(getAuthHeaders(ownerOrgId));
  });

  // Validation — a funnel that does not exist as described is rejected, not cleaned up
  it('rejects a rate that is not a leg of this chain', async () => {
    const res = await request(app)
      .put(one(brandId, 'visit_signup'))
      .set(getAuthHeaders(ownerOrgId))
      .send({ rates: { replyToMeetingPct: 40 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not price replyToMeetingPct/);
  });

  it('rejects a booking link on a chain with no meeting', async () => {
    const res = await request(app)
      .put(one(brandId, 'visit_signup'))
      .set(getAuthHeaders(ownerOrgId))
      .send({ bookingUrl: 'https://cal.com/x/30min' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no bookingUrl/);
  });

  it('rejects a page destination on a chain that never lands a click on the site', async () => {
    const res = await request(app)
      .put(one(brandId, 'reply_meeting'))
      .set(getAuthHeaders(ownerOrgId))
      .send({ destinationUrl: `https://${dom(brandId)}/x` });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no destinationUrl/);
  });

  it("rejects a page destination off the brand's own domain", async () => {
    const res = await request(app)
      .put(one(brandId, 'visit_signup'))
      .set(getAuthHeaders(ownerOrgId))
      .send({ destinationUrl: 'https://somewhere-else.com/pricing' });

    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range rate', async () => {
    const res = await request(app)
      .put(one(brandId, 'visit_signup'))
      .set(getAuthHeaders(ownerOrgId))
      .send({ rates: { visitToSignupPct: 140 } });

    expect(res.status).toBe(400);
  });

  it('rejects an unknown funnel key', async () => {
    const res = await request(app)
      .put(one(brandId, 'visit_whatsapp'))
      .set(getAuthHeaders(ownerOrgId))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown sales funnel/);
  });

  it('refuses a website-led funnel for a brand with no website', async () => {
    const res = await request(app)
      .put(one(noWebsiteBrandId, 'visit_signup'))
      .set(getAuthHeaders(ownerOrgId))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no website/);
  });

  it('lets a brand with no website declare the reply-led funnel', async () => {
    const res = await request(app)
      .put(one(noWebsiteBrandId, 'reply_meeting'))
      .set(getAuthHeaders(ownerOrgId))
      .send({ rates: { replyToMeetingPct: 35 } });

    expect(res.status).toBe(200);
    expect(res.body.funnel.rates.replyToMeetingPct).toBe(35);
  });

  // Auth
  it('rejects a malformed brand id', async () => {
    const res = await request(app).get(list('not-a-uuid')).set(getAuthHeaders(ownerOrgId));
    expect(res.status).toBe(400);
  });

  it("404s an unknown brand and 403s another org's brand", async () => {
    const unknown = await request(app)
      .get(list(unknownBrandId))
      .set(getAuthHeaders(ownerOrgId));
    expect(unknown.status).toBe(404);

    const foreign = await request(app)
      .get(list(foreignBrandId))
      .set(getAuthHeaders(ownerOrgId));
    expect(foreign.status).toBe(403);

    const foreignWrite = await request(app)
      .put(one(foreignBrandId, 'reply_meeting'))
      .set(getAuthHeaders(ownerOrgId))
      .send({});
    expect(foreignWrite.status).toBe(403);
  });

  // Stating the WHOLE set — and the answer that has no other way to be given
  it('states the whole set at once', async () => {
    const res = await request(app)
      .put(list(noWebsiteBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ funnelKeys: ['reply_meeting'] });

    expect(res.status).toBe(200);
    expect(res.body.declared).toBe(true);
    expect(res.body.funnels.map((f: any) => f.funnelKey)).toEqual(['reply_meeting']);
  });

  it('restating a set keeps the economics of the funnels still in it', async () => {
    const res = await request(app)
      .put(list(noWebsiteBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ funnelKeys: ['reply_meeting'] });

    expect(res.status).toBe(200);
    // Priced by an earlier test; restating the set must not wipe it.
    expect(res.body.funnels[0].rates.replyToMeetingPct).toBe(35);
  });

  it('a funnel dropped from the set loses its declaration and its economics', async () => {
    await request(app)
      .put(list(noWebsiteBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ funnelKeys: [] });

    const back = await request(app)
      .put(list(noWebsiteBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ funnelKeys: ['reply_meeting'] });

    expect(back.status).toBe(200);
    expect(back.body.funnels[0].rates.replyToMeetingPct).toBeNull();
  });

  it('a brand can state it sells through NOTHING, and that is not the same as silence', async () => {
    const res = await request(app)
      .put(list(noWebsiteBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ funnelKeys: [] });

    expect(res.status).toBe(200);
    // The whole point: an empty list the brand STATED, versus the empty list of
    // a brand that has never said anything. Same funnels, opposite answers.
    expect(res.body).toEqual({ declared: true, funnels: [] });
  });

  it('removing the last funnel leaves the set STATED, not blank', async () => {
    await request(app)
      .put(one(noWebsiteBrandId, 'reply_meeting'))
      .set(getAuthHeaders(ownerOrgId))
      .send({});
    const res = await request(app)
      .delete(one(noWebsiteBrandId, 'reply_meeting'))
      .set(getAuthHeaders(ownerOrgId));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ declared: true, funnels: [] });
  });

  it('rejects the whole set when one member cannot apply, writing nothing', async () => {
    const before = await request(app)
      .get(list(noWebsiteBrandId))
      .set(getAuthHeaders(ownerOrgId));

    const res = await request(app)
      .put(list(noWebsiteBrandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ funnelKeys: ['reply_meeting', 'visit_signup'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no website/);

    const after = await request(app)
      .get(list(noWebsiteBrandId))
      .set(getAuthHeaders(ownerOrgId));
    expect(after.body).toEqual(before.body);
  });

  it('rejects an unknown key in the set', async () => {
    const res = await request(app)
      .put(list(brandId))
      .set(getAuthHeaders(ownerOrgId))
      .send({ funnelKeys: ['visit_whatsapp'] });

    expect(res.status).toBe(400);
  });

  // Internal read — what campaign-service arbitration ranks over
  it('serves the declared set to a service caller with no org context', async () => {
    const res = await request(app)
      .get(`/internal/brands/${brandId}/sales-funnels`)
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    expect(res.body.funnels.map((f: any) => f.funnelKey)).toEqual([
      'reply_meeting',
      'visit_signup',
      'visit_form',
    ]);
    expect(res.body.declared).toBe(true);
    expect(res.body.funnels[0].currentGoal).toBe('meetingBooked');
  });

  it('tells a service caller a brand has said nothing, rather than that it sells nothing', async () => {
    // A real brand — it exists, it has simply never answered the question.
    const res = await request(app)
      .get(`/internal/brands/${foreignBrandId}/sales-funnels`)
      .set(getInternalAuthHeaders());

    expect(res.status).toBe(200);
    // A gap the caller must surface, NOT an empty set it should rank on.
    expect(res.body).toEqual({ declared: false, funnels: [] });
  });

  it('404s a brand it holds nothing for, rather than calling a bad id a gap', async () => {
    const res = await request(app)
      .get(`/internal/brands/${unknownBrandId}/sales-funnels`)
      .set(getInternalAuthHeaders());

    // The third answer. Served as `declared: false` it would read as a producer
    // gap the caller should surface and wait on — but no statement is coming for
    // a brand that does not exist.
    expect(res.status).toBe(404);
  });
});
