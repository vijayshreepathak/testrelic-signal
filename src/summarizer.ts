/**
 * summarizer.ts — translate the top failures into four short lines a developer
 * with zero QA background can act on. No stack-trace dumping: we extract the
 * *signal* from the error, not 800 lines of noise.
 */
import { FailureSummary, FlakeVerdict, ScoredFailure } from './types';

export interface SummarizeOptions {
  /** How many top failures to summarize (default 3). */
  limit?: number;
}

export function summarizeFailures(
  scored: ScoredFailure[],
  flakeVerdicts: FlakeVerdict[],
  options: SummarizeOptions = {}
): FailureSummary[] {
  const limit = options.limit ?? 3;
  const verdictByTest = new Map(flakeVerdicts.map((v) => [v.test, v]));

  return scored.slice(0, limit).map((failure) => {
    const verdict = verdictByTest.get(failure.test.name);
    return {
      test: failure.test.name,
      whatFailed: describeWhatFailed(failure),
      whyItMatters: `${failure.whyItMatters} Affected: ${failure.affectedUsers}.`,
      flakyOrReal: describeVerdict(verdict),
      whatToDoNext: describeNextStep(failure, verdict),
    };
  });
}

function describeWhatFailed(failure: ScoredFailure): string {
  const flow = flowLabel(failure);
  const signal = extractErrorSignal(failure.test.errorMessage);
  if (signal) return `The ${flow} broke: ${signal}`;
  return `The ${flow} failed during "${failure.test.name}".`;
}

/** A human label for the affected flow, derived from the matched category. */
function flowLabel(failure: ScoredFailure): string {
  const haystack = `${failure.test.name} ${failure.test.suite ?? ''} ${failure.test.filePath ?? ''}`.toLowerCase();
  if (/checkout|payment|pay|billing|cart|charge|invoice/.test(haystack)) return 'checkout / payment flow';
  if (/login|sign[\s-]?in|auth|session|logout|password/.test(haystack)) return 'login / authentication flow';
  if (/sign[\s-]?up|onboard|register/.test(haystack)) return 'sign-up / onboarding flow';
  if (/account|profile/.test(haystack)) return 'account flow';
  if (/search|filter|sort/.test(haystack)) return 'search / discovery flow';
  if (/nav|menu|route|link/.test(haystack)) return 'navigation flow';
  return `${failure.severity}-impact flow`;
}

/**
 * Pull the meaningful line(s) out of a Playwright/CTRF error message. We prefer
 * the assertion summary (Expected/Received) and the first error line; we drop
 * the rest of the stack so the founder sees signal, not a wall of text.
 */
export function extractErrorSignal(message?: string): string | undefined {
  if (!message) return undefined;
  const lines = message
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return undefined;

  const expected = lines.find((l) => /^expected/i.test(l));
  const received = lines.find((l) => /^received/i.test(l));
  if (expected && received) {
    return `${expected.replace(/\s+/g, ' ')}, ${received.replace(/\s+/g, ' ')}`;
  }

  // Otherwise take the first non-generic line, capped to keep it scannable.
  const headline = lines[0];
  return headline.length > 140 ? `${headline.slice(0, 137)}…` : headline;
}

function describeVerdict(verdict?: FlakeVerdict): string {
  if (!verdict) {
    return 'No history available — treat as unverified until you have ≥3 runs.';
  }
  const label =
    verdict.verdict === 'likely-flaky'
      ? 'Likely FLAKY'
      : verdict.verdict === 'likely-real-bug'
        ? 'Likely a REAL BUG'
        : 'Insufficient history';
  return `${label} (${Math.round(verdict.confidence * 100)}% confidence) — ${verdict.evidence}`;
}

function describeNextStep(failure: ScoredFailure, verdict?: FlakeVerdict): string {
  if (verdict?.verdict === 'likely-flaky') {
    return 'Do NOT block the deploy on this. Re-run once to confirm it goes green, then file a flake-stabilization ticket (add waits/network stubs).';
  }
  if (verdict?.verdict === 'likely-real-bug') {
    return `Treat as a blocker. ${nextStepForFlow(failure)}`;
  }
  // insufficient-history or unknown
  return `Re-run the suite 2–3 more times to build history, then re-check. If it keeps failing, ${nextStepForFlow(failure).toLowerCase()}`;
}

/**
 * Build prioritized, plain-English recommendations for the whole run: what to
 * block on, what to ignore as noise, and what hygiene to fix.
 */
export function buildRecommendations(scored: ScoredFailure[], flakeVerdicts: FlakeVerdict[]): string[] {
  const verdictByTest = new Map(flakeVerdicts.map((v) => [v.test, v]));
  const recs: string[] = [];

  const realBugs = scored.filter((f) => verdictByTest.get(f.test.name)?.verdict === 'likely-real-bug');
  const critical = realBugs.filter((f) => f.severity === 'critical');
  const flaky = flakeVerdicts.filter((v) => v.verdict === 'likely-flaky');
  const unverified = flakeVerdicts.filter((v) => v.verdict === 'insufficient-history');

  if (critical.length > 0) {
    recs.push(
      `BLOCK THE DEPLOY: ${critical.length} critical real-bug failure(s) on revenue/access paths (top: "${critical[0].test.name}"). Fix before shipping.`
    );
  } else if (realBugs.length > 0) {
    recs.push(`Fix ${realBugs.length} likely-real-bug failure(s) before the next release; none are on the critical revenue/access path.`);
  }

  if (flaky.length > 0) {
    recs.push(
      `Ignore as noise for go/no-go: ${flaky.length} likely-flaky test(s). Re-run to confirm green, then stabilize them (waits, network stubbing) so they stop crying wolf.`
    );
  }

  if (unverified.length > 0) {
    recs.push(
      `${unverified.length} failure(s) have too little history to judge — run the suite a few more times (or pass --history) before trusting a flake/bug call.`
    );
  }

  if (recs.length === 0) {
    recs.push('No failures to action — green run. Keep the history flowing so flakiness detection stays sharp.');
  }

  return recs;
}

function nextStepForFlow(failure: ScoredFailure): string {
  const haystack = `${failure.test.name} ${failure.test.suite ?? ''} ${failure.test.filePath ?? ''}`.toLowerCase();
  if (/checkout|payment|cart|billing|charge|invoice|tax|total/.test(haystack)) {
    return 'Inspect the order-total / tax calculation in the checkout code path — the numbers in the error point to the math.';
  }
  if (/login|sign[\s-]?in|auth|session|password/.test(haystack)) {
    return 'Check the auth/session service and the login button enabled-state logic before the next deploy.';
  }
  if (/sign[\s-]?up|onboard|register/.test(haystack)) {
    return 'Verify the sign-up/onboarding submission path and validation before shipping.';
  }
  return 'Open the failing assertion in the spec file and check the code path it exercises.';
}
