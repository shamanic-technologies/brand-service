import { describe, it, expect } from 'vitest';
import {
  OUTBOUND_FEATURE_SLUGS,
  canonicalLegKey,
  canonicalCombinationKey,
  hasDuplicateCombinationKey,
  toNewCombinationKey,
  toNewCombinationKeys,
  isEntryLegKey,
  normalizeSalesPathLegs,
  bareLegKeys,
  EntryLegWithoutChannelError,
  legsFromLegacyLegKeys,
  LEGACY_SHAPE_ENTRY_CHANNEL,
  formatSalesPathLeg,
  parseSalesPathLeg,
  isLegacyOutboundLegKey,
  legacyOutboundLegKeysInCombinationKey,
} from '../../src/lib/outbound-leg-keys';
import { PutOfferSelectedSalesPathsRequestSchema } from '../../src/schemas';

const legacy =
  'start_to_conversation@sales-cold-email-outreach+conversation_to_meeting_booked@ai-meeting-booking+meeting_booked_to_meeting_attended+meeting_attended_to_paid_client';
const renamed = legacy.replace('start_to_conversation@', 'lead_found_to_conversation@');

describe('outbound leg keys: one identity, two spellings', () => {
  it('folds both legacy keys on every outbound feature, both ways', () => {
    for (const slug of OUTBOUND_FEATURE_SLUGS) {
      expect(canonicalLegKey('start_to_conversation', slug)).toBe(canonicalLegKey('lead_found_to_conversation', slug));
      expect(canonicalLegKey('start_to_website_visit', slug)).toBe(canonicalLegKey('lead_found_to_website_visit', slug));
    }
    expect(OUTBOUND_FEATURE_SLUGS.size).toBe(10);
  });

  it('never folds a non-outbound feature, a featureless key, or another leg', () => {
    expect(canonicalLegKey('start_to_website_visit', 'google-ads')).toBe('start_to_website_visit');
    expect(canonicalLegKey('start_to_website_visit', null)).toBe('start_to_website_visit');
    expect(canonicalLegKey('start_to_lead_found', 'sourcing-apollo-cold-filters')).toBe('start_to_lead_found');
    expect(canonicalLegKey('conversation_to_meeting_booked', 'sales-cold-email-outreach')).toBe('conversation_to_meeting_booked');
  });

  it('combination keys differing only by the outbound spelling compare equal', () => {
    expect(canonicalCombinationKey(legacy)).toBe(canonicalCombinationKey(renamed));
    expect(canonicalCombinationKey('start_to_website_visit@google-ads+website_visit_to_signup')).toBe(
      'start_to_website_visit@google-ads+website_visit_to_signup'
    );
    expect(hasDuplicateCombinationKey([legacy, renamed])).toBe(true);
    expect(hasDuplicateCombinationKey([legacy, legacy])).toBe(true);
    expect(
      hasDuplicateCombinationKey([
        'start_to_website_visit@google-ads+website_visit_to_signup',
        'lead_found_to_website_visit@google-ads+website_visit_to_signup',
      ])
    ).toBe(false);
  });

  it('the PUT body refuses both spellings together and keeps each value as given', () => {
    expect(PutOfferSelectedSalesPathsRequestSchema.safeParse({ combinationKeys: [legacy, renamed] }).success).toBe(false);
    const ok = PutOfferSelectedSalesPathsRequestSchema.safeParse({ combinationKeys: [renamed] });
    expect(ok.success && ok.data.combinationKeys).toEqual([renamed]);
  });
});

describe('outbound leg keys, wave 2: stored and served in the new spelling', () => {
  it('a combination key moves its outbound segments to the new spelling, nothing else', () => {
    expect(toNewCombinationKey(legacy)).toBe(renamed);
    expect(toNewCombinationKey(renamed)).toBe(renamed);
    expect(toNewCombinationKey('start_to_website_visit@google-ads+website_visit_to_signup')).toBe(
      'start_to_website_visit@google-ads+website_visit_to_signup'
    );
    expect(toNewCombinationKey('start_to_conversation')).toBe('start_to_conversation');
  });

  it('two spellings of one path collapse onto the first entry, order kept', () => {
    expect(toNewCombinationKeys(['a', legacy, 'b', renamed])).toEqual(['a', renamed, 'b']);
  });

  it('an entry leg is the first move of a lead, in either spelling', () => {
    expect(isEntryLegKey('start_to_website_visit')).toBe(true);
    expect(isEntryLegKey('lead_found_to_conversation')).toBe(true);
    expect(isEntryLegKey('start_to_lead_found')).toBe(true);
    expect(isEntryLegKey('conversation_to_paid_client')).toBe(false);
  });

  it('Google Ads and cold email each keep their own website visit, side by side', () => {
    const legs = normalizeSalesPathLegs([
      { legKey: 'start_to_website_visit', featureSlug: 'google-ads' },
      { legKey: 'start_to_website_visit', featureSlug: 'sales-cold-email-outreach' },
      { legKey: 'website_visit_to_signup', featureSlug: null },
    ]);
    expect(legs).toEqual([
      { legKey: 'start_to_website_visit', featureSlug: 'google-ads' },
      { legKey: 'lead_found_to_website_visit', featureSlug: 'sales-cold-email-outreach' },
      { legKey: 'website_visit_to_signup', featureSlug: null },
    ]);
    expect(bareLegKeys(legs)).toEqual(['start_to_website_visit', 'lead_found_to_website_visit', 'website_visit_to_signup']);
  });

  it('two spellings of one (leg, channel) collapse onto the first; another channel never does', () => {
    expect(
      normalizeSalesPathLegs([
        { legKey: 'lead_found_to_conversation', featureSlug: 'cold-linkedin-outreach' },
        { legKey: 'start_to_conversation', featureSlug: 'cold-linkedin-outreach' },
        { legKey: 'start_to_conversation', featureSlug: 'sales-cold-email-outreach' },
      ])
    ).toEqual([
      { legKey: 'lead_found_to_conversation', featureSlug: 'cold-linkedin-outreach' },
      { legKey: 'lead_found_to_conversation', featureSlug: 'sales-cold-email-outreach' },
    ]);
  });

  it('an entry leg with no channel is refused, never guessed', () => {
    expect(() => normalizeSalesPathLegs([{ legKey: 'start_to_website_visit', featureSlug: null }])).toThrow(
      EntryLegWithoutChannelError
    );
    expect(() => normalizeSalesPathLegs([{ legKey: 'lead_found_to_conversation', featureSlug: null }])).toThrow(
      EntryLegWithoutChannelError
    );
  });

  it("the legacy bare shape reads its entry legs as cold email's (the one surface that sends it)", () => {
    expect(legsFromLegacyLegKeys(['start_to_conversation', 'conversation_to_paid_client'])).toEqual([
      { legKey: 'start_to_conversation', featureSlug: LEGACY_SHAPE_ENTRY_CHANNEL },
      { legKey: 'conversation_to_paid_client', featureSlug: null },
    ]);
    expect(LEGACY_SHAPE_ENTRY_CHANNEL).toBe('sales-cold-email-outreach');
  });

  it('a stored leg round-trips through its `leg@feature` form', () => {
    for (const leg of [
      { legKey: 'start_to_website_visit', featureSlug: 'google-ads' },
      { legKey: 'conversation_to_paid_client', featureSlug: null },
    ]) {
      expect(parseSalesPathLeg(formatSalesPathLeg(leg))).toEqual(leg);
    }
    expect(formatSalesPathLeg({ legKey: 'start_to_website_visit', featureSlug: 'google-ads' })).toBe('start_to_website_visit@google-ads');
  });

  it('spots every legacy outbound spelling a caller sent, and nothing else', () => {
    expect(isLegacyOutboundLegKey('start_to_conversation', 'sales-cold-email-outreach')).toBe(true);
    expect(isLegacyOutboundLegKey('lead_found_to_conversation', 'sales-cold-email-outreach')).toBe(false);
    expect(isLegacyOutboundLegKey('start_to_website_visit', 'google-ads')).toBe(false);
    expect(isLegacyOutboundLegKey('start_to_website_visit', null)).toBe(false);
    expect(legacyOutboundLegKeysInCombinationKey(legacy)).toEqual(['start_to_conversation@sales-cold-email-outreach']);
    expect(legacyOutboundLegKeysInCombinationKey(renamed)).toEqual([]);
    expect(legacyOutboundLegKeysInCombinationKey('start_to_website_visit@google-ads+website_visit_to_signup')).toEqual([]);
  });
});
