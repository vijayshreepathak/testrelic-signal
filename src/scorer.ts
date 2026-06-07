/**
 * scorer.ts — the business-impact model. This is the differentiator.
 *
 * A red test is not the same as a business problem. We score each *failed* test
 * 0–100 by what it means for the business, combining:
 *   1. an impact WEIGHT derived from which user-facing flow the test exercises
 *      (matched against the test name, suite, file path, and tags), and
 *   2. signal MODIFIERS from history (a consistent failure on a critical path is
 *      the top alarm; a likely-flaky failure is downranked because it is noise).
 *
 * The weight table and keyword lists are exported so a team can tune them to
 * their own product without touching the scoring logic.
 */
import { FlakeVerdict, ScoredFailure, Severity, TestResult, TestRun } from './types';

/** Impact weights per severity bucket. Exported so they are tunable + testable. */
export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0.5,
};

/** Base score (pre-modifier) per severity. Tuned so critical > high > medium > low. */
const SEVERITY_BASE: Record<Severity, number> = {
  critical: 70,
  high: 50,
  medium: 30,
  low: 15,
};

/**
 * Keyword lists per severity, matched case-insensitively against the test name,
 * suite, file path, and tags. Documented here as the single source of truth.
 *
 *  - critical: revenue + access — losing these means users can't pay or get in.
 *  - high:     core data integrity — writes that, if broken, corrupt user state.
 *  - medium:   navigation / discovery — degraded UX but not data/revenue loss.
 *  - low:      cosmetic — copy, tooltips, visual polish.
 */
export const SEVERITY_KEYWORDS: Record<Severity, RegExp> = {
  critical: /\b(auth|login|logout|sign[\s-]?in|session|password|checkout|payment|pay|billing|charge|invoice|subscription|sign[\s-]?up|onboard(ing)?|register)\b/i,
  high: /\b(save|submit|create|update|delete|account|profile|api|upload|order|cart|persist|sync)\b/i,
  medium: /\b(nav(igation)?|search|filter|sort|menu|route|link|list|dashboard|settings)\b/i,
  low: /\b(tooltip|copy|label|cosmetic|visual|color|colour|spacing|font|icon|placeholder|hover|style)\b/i,
};

/** Plain-language descriptions of who is affected when a category breaks. */
const AFFECTED_USERS: Record<Severity, string> = {
  critical: 'anyone trying to sign in, sign up, or pay — directly blocks revenue and access',
  high: 'users saving or changing data — risk of lost work or corrupted account state',
  medium: 'users navigating or finding content — degraded experience, not data loss',
  low: 'cosmetic only — no functional impact on users',
};

const WHY_IT_MATTERS: Record<Severity, string> = {
  critical: 'Sits on the money/access path — a real failure here loses customers immediately.',
  high: 'A core data flow — breakage here silently corrupts or drops user data.',
  medium: 'A secondary flow — annoying and worth fixing, but not an emergency.',
  low: 'Cosmetic — safe to schedule, not to block a deploy on.',
};

export interface ScoreOptions {
  /** Optional flake verdicts keyed by test name to apply history modifiers. */
  flakeVerdicts?: FlakeVerdict[];
}

/**
 * Score every failed test and return them ranked highest-impact first.
 * `flaky` is not scored as a failure here — flakes are surfaced separately by
 * the flakiness engine. Only hard `failed` tests are business-impact ranked.
 */
export function scoreFailures(run: TestRun, options: ScoreOptions = {}): ScoredFailure[] {
  const verdictByTest = new Map((options.flakeVerdicts ?? []).map((v) => [v.test, v]));

  const scored = run.tests
    .filter((t) => t.status === 'failed')
    .map((test) => scoreOne(test, verdictByTest.get(test.name)));

  // Stable sort by score desc; tie-break by severity rank then name.
  return scored.sort((a, b) => b.score - a.score || severityRank(b.severity) - severityRank(a.severity) || a.test.name.localeCompare(b.test.name));
}

function scoreOne(test: TestResult, verdict?: FlakeVerdict): ScoredFailure {
  const { severity, matchedCategory } = classify(test);
  const weight = SEVERITY_WEIGHTS[severity];
  let score = SEVERITY_BASE[severity];
  const modifiers: string[] = [];

  if (verdict) {
    if (verdict.verdict === 'likely-real-bug') {
      score += 25;
      modifiers.push('consistent/again-failing across history (+25, top alarm)');
    } else if (verdict.verdict === 'likely-flaky') {
      score -= 20;
      modifiers.push('looks flaky across history (-20, likely noise not a bug)');
    } else {
      modifiers.push('thin history — no confident flake signal applied');
    }
  } else {
    modifiers.push('no history match — scored on impact alone');
  }

  // A test that needed retries within this single run is a softer flake hint.
  if (test.retries > 0) {
    score -= 5;
    modifiers.push(`passed only after ${test.retries} retr${test.retries === 1 ? 'y' : 'ies'} (-5)`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    test,
    severity,
    weight,
    score,
    matchedCategory,
    whyItMatters: WHY_IT_MATTERS[severity],
    affectedUsers: AFFECTED_USERS[severity],
    modifiers,
  };
}

/**
 * Classify a test into a severity bucket. We check the most severe categories
 * first, scanning name + suite + filePath + tags together so that, e.g., a test
 * named "redirects" living in `checkout.spec.ts` is still treated as critical.
 */
export function classify(test: TestResult): { severity: Severity; matchedCategory: string } {
  const haystack = [test.name, test.suite ?? '', test.filePath ?? '', ...(test.tags ?? [])]
    .join(' ')
    .toLowerCase();

  const order: Severity[] = ['critical', 'high', 'medium', 'low'];
  for (const severity of order) {
    const match = SEVERITY_KEYWORDS[severity].exec(haystack);
    if (match) {
      return { severity, matchedCategory: `${severity}:"${match[0].trim()}"` };
    }
  }
  // Unmatched failures default to medium: unknown impact is not assumed cosmetic.
  return { severity: 'medium', matchedCategory: 'medium:unclassified' };
}

function severityRank(severity: Severity): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity];
}
