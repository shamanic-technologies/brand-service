import type { ZodError } from 'zod';

/**
 * A 400 a caller can act on from its top-level line alone (AGENT-SIGNUP-UX-1125).
 *
 * An outside AI agent onboarding through our public API read only `error` and
 * got `"Invalid request"` on four calls in a row, with the field buried in
 * `details.fieldErrors` (or, for a union body, nowhere at all). The gateway is a
 * passthrough, so this sentence is what every caller sees. It names each
 * offending field and what was expected; a route may add `hints` (keyed by field
 * path, `''` for the whole body) saying where a value comes from (a previous
 * call's answer). `details` (zod `flatten()`) is kept byte-identical for
 * backward compatibility.
 */

const MAX_ISSUES_LISTED = 5;

type Issue = ZodError['issues'][number];
type UnionIssue = Issue & { code: 'invalid_union'; errors?: Issue[][] };

function pathOf(issue: Issue): string {
  return issue.path.map(String).join('.');
}

function describeIssue(issue: Issue): string {
  const path = pathOf(issue);
  if (issue.code === 'invalid_union') {
    const alternatives = ((issue as UnionIssue).errors ?? [])
      .map((branch) => branch.map(describeIssue).join(', '))
      .filter((text) => text.length > 0);
    const where = path ? `${path} ` : 'body ';
    if (alternatives.length > 0) {
      return `${where}matches none of the accepted shapes (${alternatives.map((a) => `{ ${a} }`).join(' OR ')})`;
    }
    return `${where}matches none of the accepted shapes`;
  }
  if (issue.code === 'unrecognized_keys') {
    const keys = (issue as Issue & { keys?: string[] }).keys ?? [];
    return `${path ? `${path}: ` : ''}unknown field(s) ${keys.map((k) => `"${k}"`).join(', ')}`;
  }
  return `${path || 'body'}: ${issue.message}`;
}

/** The one-line sentence: every offending field + what was expected (+ hints). Pure. */
export function describeValidationError(error: ZodError, hints: Record<string, string> = {}): string {
  const issues = error.issues;
  const listed = issues.slice(0, MAX_ISSUES_LISTED).map(describeIssue);
  const more = issues.length > MAX_ISSUES_LISTED ? ` (+${issues.length - MAX_ISSUES_LISTED} more in details)` : '';
  const hintTexts: string[] = [];
  const seen = new Set<string>();
  const addHint = (key: string) => {
    const hint = hints[key];
    if (hint && !seen.has(key)) {
      seen.add(key);
      hintTexts.push(hint);
    }
  };
  for (const issue of issues) {
    const path = pathOf(issue);
    addHint(path);
    // A nested path (`offers.0.name`) is helped by its top-level field's hint.
    addHint(String(issue.path[0] ?? ''));
  }
  const head = listed.length > 0 ? `Invalid request: ${listed.join('; ')}${more}` : 'Invalid request';
  return hintTexts.length > 0 ? `${head}. ${hintTexts.join(' ')}` : head;
}

/** The 400 body: `{ error: <sentence>, details: flatten() }`. Pure. */
export function invalidRequestBody(
  error: ZodError,
  hints?: Record<string, string>,
): { error: string; details: ReturnType<ZodError['flatten']> } {
  return { error: describeValidationError(error, hints), details: error.flatten() };
}
