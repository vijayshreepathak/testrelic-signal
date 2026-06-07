/**
 * types.ts — the single source of truth for testrelic-signal.
 *
 * Everything downstream (parser, scorer, flakiness, summarizer, report, uploader)
 * imports from here. The internal model is deliberately decoupled from any input
 * format (CTRF or raw Playwright JSON) so the rest of the pipeline never has to
 * care where the data came from.
 */

export type TestStatus = 'passed' | 'failed' | 'flaky' | 'skipped';

/** A single normalized test result, independent of the source report format. */
export interface TestResult {
  /** Human-ish test title (e.g. "checkout applies the correct tax"). */
  name: string;
  /** Suite / describe block the test belongs to, if known. */
  suite?: string;
  status: TestStatus;
  durationMs: number;
  /** Number of retries Playwright performed for this test (0 if unknown). */
  retries: number;
  errorMessage?: string;
  errorStack?: string;
  /** Source spec file, used by the scorer for business-impact keyword matching. */
  filePath?: string;
  /** Playwright tags / annotations (e.g. ["@critical", "@checkout"]). */
  tags?: string[];
}

/** Normalized representation of one test run. */
export interface TestRun {
  /** Origin tool, best-effort ("playwright", "ctrf", "unknown"). */
  tool: string;
  /** ISO timestamp for when the run started, best-effort. */
  timestamp: string;
  totals: {
    passed: number;
    failed: number;
    flaky: number;
    skipped: number;
  };
  tests: TestResult[];
}

/** Business-impact severity buckets. The weight is applied to a base signal. */
export type Severity = 'critical' | 'high' | 'medium' | 'low';

/** A failed test enriched with business-impact scoring. */
export interface ScoredFailure {
  test: TestResult;
  severity: Severity;
  /** Weight from the (exported, tunable) weight table for this severity. */
  weight: number;
  /** Final 0–100 score combining impact weight + signal modifiers. */
  score: number;
  /** Why the scorer assigned this severity (which keyword/path matched). */
  matchedCategory: string;
  /** One-line, plain-English reason this failure matters to the business. */
  whyItMatters: string;
  /** Plain-language estimate of who is affected ("anyone trying to log in"). */
  affectedUsers: string;
  /** Human-readable notes about modifiers applied (history, first-seen, etc). */
  modifiers: string[];
}

export type FlakeVerdictLabel =
  | 'likely-flaky'
  | 'likely-real-bug'
  | 'insufficient-history';

/** The flakiness engine's verdict for a single test, with cited evidence. */
export interface FlakeVerdict {
  test: string;
  verdict: FlakeVerdictLabel;
  /** 0–1 confidence in the verdict. Low when history is thin. */
  confidence: number;
  /** Concrete, citable evidence — e.g. "failed 1/5 recent runs, passed on retry twice". */
  evidence: string;
}

/** The four plain-English lines a non-QA developer can act on. */
export interface FailureSummary {
  test: string;
  whatFailed: string;
  whyItMatters: string;
  flakyOrReal: string;
  whatToDoNext: string;
}

/** Final report object produced by the pipeline and (optionally) uploaded. */
export interface RunSignal {
  run: TestRun;
  /** Failures ranked by business impact (highest first). */
  scoredFailures: ScoredFailure[];
  /** Flake verdicts for every test that failed at least once. */
  flakeVerdicts: FlakeVerdict[];
  /** Plain-English summaries for the top failures. */
  summaries: FailureSummary[];
  /** Actionable, prioritized recommendations for the team. */
  recommendations: string[];
  /** Set after a successful upload. */
  upload?: UploadResult;
}

export interface UploadResult {
  uploaded: boolean;
  /** Dashboard URL on success. */
  dashboardUrl?: string;
  /** Non-fatal reason when skipped/failed (always logged, never swallowed). */
  reason?: string;
}

/** A typed, human-readable error the CLI catches and renders cleanly. */
export class SignalError extends Error {
  constructor(
    message: string,
    /** A concrete remediation hint shown to the user. */
    public readonly remediation?: string
  ) {
    super(message);
    this.name = 'SignalError';
  }
}
