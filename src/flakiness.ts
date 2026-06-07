/**
 * flakiness.ts — separate flaky noise from real bugs using run history.
 *
 * The whole product thesis is that "red" is ambiguous: a flake and a real
 * regression look identical in a single report. We disambiguate by looking at
 * how a test behaved across the last N runs:
 *
 *   - Strong FLAKY signal:  status alternates pass/fail with no code change,
 *     OR the test passed only after a retry within a single run, OR it fails
 *     intermittently across runs.
 *   - Strong REAL-BUG signal: fails consistently across the last N runs, OR is
 *     newly failing and *stays* failed (a regression).
 *
 * With < 3 observations we refuse to guess and return `insufficient-history`
 * rather than emit a confident-but-wrong verdict (a graded failure mode).
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseFile } from './parser';
import { FlakeVerdict, TestRun, TestStatus } from './types';

export interface HistoryLoad {
  runs: TestRun[];
  /** Files that could not be parsed — surfaced, never silently dropped. */
  skipped: { file: string; reason: string }[];
}

/**
 * Load every *.json run in a history directory, oldest → newest by timestamp
 * (falling back to file name). Unparseable files are skipped and reported, not
 * thrown — one bad history file must never break the analysis.
 */
export function loadHistory(dir: string): HistoryLoad {
  const result: HistoryLoad = { runs: [], skipped: [] };
  if (!dir || !existsSync(dir)) return result;

  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .sort();

  for (const file of files) {
    const full = join(dir, file);
    try {
      result.runs.push(parseFile(full));
    } catch (err) {
      result.skipped.push({ file, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  result.runs.sort((a, b) => {
    const ta = Date.parse(a.timestamp) || 0;
    const tb = Date.parse(b.timestamp) || 0;
    return ta - tb;
  });
  return result;
}

const FAIL_LIKE: TestStatus[] = ['failed', 'flaky'];

/**
 * Compute a verdict for every test that failed or was flaky in the current run.
 * History is the prior runs (oldest → newest); the current run is appended as
 * the most recent observation.
 */
export function computeFlakeVerdicts(currentRun: TestRun, history: TestRun[]): FlakeVerdict[] {
  const verdicts: FlakeVerdict[] = [];
  const subjects = currentRun.tests.filter((t) => t.status === 'failed' || t.status === 'flaky');

  for (const test of subjects) {
    verdicts.push(verdictFor(test.name, currentRun, history));
  }
  return verdicts;
}

function verdictFor(name: string, currentRun: TestRun, history: TestRun[]): FlakeVerdict {
  const current = currentRun.tests.find((t) => t.name === name);
  const passedOnRetry = !!current && current.retries > 0 && current.status !== 'failed';

  // Build the chronological status sequence (history then current), dropping
  // runs where the test was absent or skipped — those carry no pass/fail signal.
  const sequence: TestStatus[] = [];
  let retryRuns = 0;
  for (const run of history) {
    const t = run.tests.find((x) => x.name === name);
    if (!t || t.status === 'skipped') continue;
    sequence.push(t.status);
    if (t.retries > 0) retryRuns += 1;
  }
  if (current && current.status !== 'skipped') {
    sequence.push(current.status);
    if (current.retries > 0) retryRuns += 1;
  }

  const total = sequence.length;
  const failLike = sequence.filter((s) => FAIL_LIKE.includes(s)).length;
  const passes = sequence.filter((s) => s === 'passed').length;
  const flakyMarked = sequence.filter((s) => s === 'flaky').length;
  const transitions = countTransitions(sequence);
  const tailFailStreak = trailingFailStreak(sequence);

  // 1) Passed-on-retry within a single run is the textbook flake — high signal
  //    even when overall history is thin.
  if (passedOnRetry) {
    return {
      test: name,
      verdict: 'likely-flaky',
      confidence: 0.75,
      evidence: `passed only after ${current!.retries} retry/retries in the latest run — classic flake (seen failing then passing without a code change).`,
    };
  }

  // 2) Refuse to guess on thin evidence.
  if (total < 3) {
    return {
      test: name,
      verdict: 'insufficient-history',
      confidence: 0.2,
      evidence: `only ${total} usable observation(s) available — need ≥3 runs to tell a flake from a real bug. Add more history with --history or re-run a few times.`,
    };
  }

  // 3) Consistent failure across the whole window → real bug.
  if (failLike === total && flakyMarked === 0) {
    return {
      test: name,
      verdict: 'likely-real-bug',
      confidence: clamp(0.6 + 0.08 * total, 0, 0.95),
      evidence: `failed all ${total} recent runs with no passing run — consistent, deterministic failure, not flake.`,
    };
  }

  // 4) Newly failing and staying failed (a regression): earlier passes, then a
  //    tail of ≥2 consecutive failures with no recovery.
  if (passes > 0 && tailFailStreak >= 2 && flakyMarked === 0 && transitions <= 1) {
    return {
      test: name,
      verdict: 'likely-real-bug',
      confidence: 0.72,
      evidence: `passed earlier, then failed the last ${tailFailStreak} runs straight with no recovery — looks like a regression, not flake.`,
    };
  }

  // 5) Alternating / intermittent / explicitly flaky → flaky.
  if (transitions >= 2 || flakyMarked > 0 || (passes > 0 && failLike > 0)) {
    const conf = clamp(0.5 + 0.1 * transitions + (flakyMarked > 0 ? 0.1 : 0) + (retryRuns > 0 ? 0.05 : 0), 0, 0.9);
    return {
      test: name,
      verdict: 'likely-flaky',
      confidence: conf,
      evidence: `failed ${failLike}/${total} recent runs, status flipped ${transitions} time(s)${
        retryRuns > 0 ? `, passed on retry in ${retryRuns} run(s)` : ''
      }${flakyMarked > 0 ? `, marked flaky ${flakyMarked} time(s)` : ''} — intermittent.`,
    };
  }

  // 6) Fallback: predominantly failing without alternation → lean real bug.
  return {
    test: name,
    verdict: 'likely-real-bug',
    confidence: 0.6,
    evidence: `failed ${failLike}/${total} recent runs and is failing now — more consistent than intermittent.`,
  };
}

function countTransitions(sequence: TestStatus[]): number {
  let transitions = 0;
  for (let i = 1; i < sequence.length; i++) {
    const prevFail = FAIL_LIKE.includes(sequence[i - 1]);
    const curFail = FAIL_LIKE.includes(sequence[i]);
    if (prevFail !== curFail) transitions += 1;
  }
  return transitions;
}

function trailingFailStreak(sequence: TestStatus[]): number {
  let streak = 0;
  for (let i = sequence.length - 1; i >= 0; i--) {
    if (FAIL_LIKE.includes(sequence[i])) streak += 1;
    else break;
  }
  return streak;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value.toFixed(2))));
}
