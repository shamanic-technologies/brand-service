import { describe, it, expect } from 'vitest';
import {
  OUTBOUND_FEATURE_SLUGS,
  canonicalLegKey,
  canonicalCombinationKey,
  hasDuplicateCombinationKey,
  toNewCombinationKey,
  toNewCombinationKeys,
  toNewSalesPathLegKeys,
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

  it("an offer's bare sales-path legs are folded (cold email is the only entry channel there)", () => {
    expect(
      toNewSalesPathLegKeys(['start_to_conversation', 'conversation_to_paid_client', 'start_to_website_visit', 'lead_found_to_conversation'])
    ).toEqual(['lead_found_to_conversation', 'conversation_to_paid_client', 'lead_found_to_website_visit']);
    expect(toNewSalesPathLegKeys(['start_to_lead_found', 'website_visit_to_signup'])).toEqual([
      'start_to_lead_found',
      'website_visit_to_signup',
    ]);
  });
});
