/**
 * Pure half of "is this website THAT company?" (COMPETITOR-SITE-IS-THE-COMPANY-1024).
 *
 * A model names a competitor and guesses its domain. A guessed domain that
 * loads can still belong to SOMEBODY ELSE (deltastrike.vip, 2026-10-24: "Velo
 * Data (velo.xyz)": Velo Data lives at velodata.app, velo.xyz is another
 * project). The verdict is a Jev judgment (chat-service `noul`), never a title or
 * name string match: one question per candidate site, all on ONE state, so a
 * whole discovery is judged in a single call.
 *
 * No db, no fetch: the service reads the pages and calls Jev; this module builds
 * the question and reads the answer.
 */

import type { NoulJudgmentQuestion } from './chat-client';

/** A site is that company's only when Jev's probability of yes reaches this. */
export const MIN_WEBSITE_CONFIDENCE = 0.5;
/** Each candidate page is shown to Jev up to this many characters of visible text. */
export const JUDGED_PAGE_MAX_CHARS = 3000;
/** At most this many domains are tried per competitor (the model's first guess, then its alternatives). */
export const MAX_CANDIDATE_DOMAINS = 3;

export interface JudgedCandidate {
  /** Question key, unique in the call (`c<competitor>_<candidate>`). */
  key: string;
  companyName: string;
  domain: string;
  /** Visible text of the page the domain serves. */
  pageText: string;
}

export interface WebsiteJudgment {
  state: {
    seller: { name: string | null; website: string | null };
    task: string;
    sites: Record<string, { companyName: string; domain: string; homepageText: string }>;
  };
  questions: Record<string, NoulJudgmentQuestion>;
}

export function candidateKey(competitorIndex: number, candidateIndex: number): string {
  return `c${competitorIndex}_${candidateIndex}`;
}

/** The Jev state + one yes/no question per candidate site. Pure. */
export function buildWebsiteJudgment(
  seller: { name: string | null; website: string | null },
  candidates: JudgedCandidate[],
): WebsiteJudgment {
  const sites: WebsiteJudgment['state']['sites'] = {};
  const questions: Record<string, NoulJudgmentQuestion> = {};
  for (const c of candidates) {
    sites[c.key] = {
      companyName: c.companyName,
      domain: c.domain,
      homepageText: c.pageText.slice(0, JUDGED_PAGE_MAX_CHARS),
    };
    questions[c.key] = {
      type: 'noul',
      instructions:
        `Read sites.${c.key}: the homepage served at ${c.domain}. Is this website the OWN official website ` +
        `of the company named "${c.companyName}" (named as a competitor of the seller)?`,
      criteria: {
        true:
          `The page is ${c.companyName}'s own site: it presents that company and its product or service ` +
          '(a rebrand or a parent brand that clearly sells it counts).',
        false:
          'The page belongs to a different company or project (even with a similar name), or is a parked / ' +
          'for-sale domain, an empty or error page, a directory, a review site or an article ABOUT the company.',
      },
    };
  }
  return {
    state: {
      seller,
      task: 'For each site, judge whether the domain really is the named company\'s own website.',
      sites,
    },
    questions,
  };
}

export interface CompetitorSiteVerdict {
  /** The first candidate (in the model's order) judged to be the company, else null. */
  domain: string | null;
  /** Jev's probability for the confirmed domain; when none is confirmed, the best one seen (null = nothing judged). */
  confidence: number | null;
}

/**
 * The verdict for one competitor: the first candidate judged its own site.
 * A candidate that could not be read was never judged (absent from
 * `probabilities`) and is never confirmed. Pure.
 */
export function pickConfirmedDomain(
  candidates: { key: string; domain: string }[],
  probabilities: Record<string, number>,
): CompetitorSiteVerdict {
  let best: number | null = null;
  for (const c of candidates) {
    const p = probabilities[c.key];
    if (typeof p !== 'number') continue;
    if (p >= MIN_WEBSITE_CONFIDENCE) return { domain: c.domain, confidence: p };
    best = best === null ? p : Math.max(best, p);
  }
  return { domain: null, confidence: best };
}
