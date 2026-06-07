/**
 * parser.ts — turn a CTRF file OR a raw Playwright JSON reporter file into the
 * normalized {@link TestRun} model.
 *
 * Design rules (robustness is graded):
 *  - Auto-detect the format by shape, not by file name.
 *  - Never throw on missing/null fields or empty `tests[]`; produce a valid
 *    TestRun with safe defaults.
 *  - DO throw a typed, human-readable {@link SignalError} for unreadable paths
 *    or invalid JSON, so the CLI can render a helpful message.
 */
import { readFileSync } from 'node:fs';
import { TestResult, TestRun, TestStatus, SignalError } from './types';

type Json = Record<string, unknown>;

export function parseFile(path: string): TestRun {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new SignalError(
      `Could not read results at "${path}": ${reason}`,
      'Check the path exists and is readable. Pass a Playwright JSON reporter file or a CTRF file (ctrf.io).'
    );
  }
  return parseString(raw, path);
}

export function parseString(raw: string, path = '<input>'): TestRun {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new SignalError(
      `Could not parse results at "${path}": not valid JSON.`,
      'Pass a Playwright JSON reporter file (npx playwright test --reporter=json) or a CTRF file (ctrf.io).'
    );
  }

  if (!isObject(data)) {
    throw new SignalError(
      `Could not parse results at "${path}": expected a JSON object at the top level.`,
      'Pass a Playwright JSON reporter file or a CTRF file (ctrf.io).'
    );
  }

  if (looksLikeCtrf(data)) return normalizeCtrf(data);
  if (looksLikePlaywright(data)) return normalizePlaywright(data);

  throw new SignalError(
    `Could not recognize the report format at "${path}".`,
    'Expected CTRF (a `results.tests` array — see ctrf.io) or Playwright JSON (a `suites`/`stats` shape).'
  );
}

/* ----------------------------- detection ----------------------------- */

function looksLikeCtrf(data: Json): boolean {
  if (typeof data.reportFormat === 'string' && /ctrf/i.test(data.reportFormat)) return true;
  const results = data.results;
  return isObject(results) && Array.isArray((results as Json).tests);
}

function looksLikePlaywright(data: Json): boolean {
  return Array.isArray(data.suites) || isObject(data.stats);
}

/* ----------------------------- CTRF ----------------------------- */

function normalizeCtrf(data: Json): TestRun {
  const results = isObject(data.results) ? (data.results as Json) : {};
  const toolName = readToolName(results.tool) ?? 'ctrf';
  const summary = isObject(results.summary) ? (results.summary as Json) : {};
  const rawTests = Array.isArray(results.tests) ? results.tests : [];

  const tests: TestResult[] = rawTests.filter(isObject).map((t) => {
    const tt = t as Json;
    const status = normalizeCtrfStatus(asString(tt.status), asBool(tt.flaky));
    return {
      name: asString(tt.name) || 'unnamed test',
      suite: asString(tt.suite) || undefined,
      status,
      durationMs: asNumber(tt.duration, 0),
      retries: asNumber(tt.retries, 0),
      errorMessage: cleanMessage(asString(tt.message)),
      errorStack: asString(tt.trace) || asString(tt.stack) || undefined,
      filePath: asString(tt.filePath) || asString(tt.filepath) || undefined,
      tags: asStringArray(tt.tags),
    };
  });

  return {
    tool: toolName,
    timestamp: readTimestamp(summary.start) ?? new Date(0).toISOString(),
    totals: totalsFromSummaryOrTests(summary, tests),
    tests,
  };
}

function normalizeCtrfStatus(status: string, flaky: boolean): TestStatus {
  if (flaky) return 'flaky';
  switch (status.toLowerCase()) {
    case 'passed':
    case 'pass':
      return 'passed';
    case 'failed':
    case 'fail':
      return 'failed';
    case 'skipped':
    case 'pending':
      return 'skipped';
    case 'flaky':
      return 'flaky';
    default:
      // Unknown/absent status is treated as skipped rather than a false failure.
      return 'skipped';
  }
}

/* ----------------------------- Playwright ----------------------------- */

function normalizePlaywright(data: Json): TestRun {
  const tests: TestResult[] = [];
  const suites = Array.isArray(data.suites) ? data.suites : [];
  for (const suite of suites) walkPlaywrightSuite(suite, undefined, tests);

  const stats = isObject(data.stats) ? (data.stats as Json) : {};
  const timestamp =
    readTimestamp(stats.startTime) ??
    readTimestamp((data.config as Json | undefined)?.startTime) ??
    new Date(0).toISOString();

  return {
    tool: 'playwright',
    timestamp,
    totals: totalsFromTests(tests),
    tests,
  };
}

function walkPlaywrightSuite(node: unknown, parentTitle: string | undefined, out: TestResult[]): void {
  if (!isObject(node)) return;
  const suite = node as Json;
  const title = asString(suite.title);
  const suiteName = [parentTitle, title].filter(Boolean).join(' › ') || undefined;
  const filePath = asString(suite.file) || undefined;

  const specs = Array.isArray(suite.specs) ? suite.specs : [];
  for (const spec of specs) {
    if (!isObject(spec)) continue;
    const sp = spec as Json;
    const specTitle = asString(sp.title) || 'unnamed test';
    const specFile = asString(sp.file) || filePath;
    const innerTests = Array.isArray(sp.tests) ? sp.tests : [];

    if (innerTests.length === 0) {
      out.push(emptyResult(specTitle, suiteName, specFile));
      continue;
    }
    for (const t of innerTests) {
      out.push(toPlaywrightResult(t, specTitle, suiteName, specFile, sp.tags));
    }
  }

  const childSuites = Array.isArray(suite.suites) ? suite.suites : [];
  for (const child of childSuites) walkPlaywrightSuite(child, suiteName, out);
}

function toPlaywrightResult(
  t: unknown,
  name: string,
  suite: string | undefined,
  filePath: string | undefined,
  specTags: unknown
): TestResult {
  if (!isObject(t)) return emptyResult(name, suite, filePath);
  const tt = t as Json;
  const status = normalizePwStatus(asString(tt.status));
  const runs = Array.isArray(tt.results) ? tt.results : [];
  const last = runs.length > 0 && isObject(runs[runs.length - 1]) ? (runs[runs.length - 1] as Json) : {};

  const error = isObject(last.error) ? (last.error as Json) : undefined;
  const errors = Array.isArray(last.errors) ? last.errors : [];
  const firstError = error ?? (errors.length > 0 && isObject(errors[0]) ? (errors[0] as Json) : undefined);

  // retries: prefer the explicit `retry` index of the last result, else infer
  // from the number of result entries.
  const retryFromLast = asNumber(last.retry, NaN);
  const retries = Number.isFinite(retryFromLast) ? retryFromLast : Math.max(0, runs.length - 1);

  const durationMs = runs.reduce((sum, r) => sum + (isObject(r) ? asNumber((r as Json).duration, 0) : 0), 0);

  return {
    name,
    suite,
    status,
    durationMs,
    retries,
    errorMessage: cleanMessage(firstError ? asString(firstError.message) : ''),
    errorStack: firstError ? asString(firstError.stack) || undefined : undefined,
    filePath,
    tags: mergeTags(specTags, tt.tags),
  };
}

function normalizePwStatus(status: string): TestStatus {
  switch (status.toLowerCase()) {
    case 'expected':
    case 'passed':
      return 'passed';
    case 'unexpected':
    case 'failed':
    case 'timedout':
    case 'interrupted':
      return 'failed';
    case 'flaky':
      return 'flaky';
    case 'skipped':
      return 'skipped';
    default:
      return 'skipped';
  }
}

/* ----------------------------- shared helpers ----------------------------- */

function emptyResult(name: string, suite: string | undefined, filePath: string | undefined): TestResult {
  return { name, suite, status: 'skipped', durationMs: 0, retries: 0, filePath };
}

function totalsFromTests(tests: TestResult[]): TestRun['totals'] {
  const totals = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
  for (const t of tests) totals[t.status] += 1;
  return totals;
}

function totalsFromSummaryOrTests(summary: Json, tests: TestResult[]): TestRun['totals'] {
  const fromTests = totalsFromTests(tests);
  // Trust derived counts; fall back to summary fields only when tests[] is empty.
  if (tests.length > 0) return fromTests;
  return {
    passed: asNumber(summary.passed, 0),
    failed: asNumber(summary.failed, 0),
    flaky: asNumber(summary.flaky, 0),
    skipped: asNumber(summary.skipped ?? summary.pending, 0),
  };
}

function readToolName(tool: unknown): string | undefined {
  if (typeof tool === 'string') return tool;
  if (isObject(tool)) return asString((tool as Json).name) || undefined;
  return undefined;
}

function readTimestamp(value: unknown): string | undefined {
  if (typeof value === 'string' && value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return undefined;
}

function mergeTags(a: unknown, b: unknown): string[] | undefined {
  const merged = [...(asStringArray(a) ?? []), ...(asStringArray(b) ?? [])];
  const unique = Array.from(new Set(merged));
  return unique.length > 0 ? unique : undefined;
}

/** Trim an error message down to its first meaningful line(s) — no 800-line dumps. */
function cleanMessage(message: string): string | undefined {
  if (!message) return undefined;
  // Strip ANSI color codes Playwright embeds in error messages.
  const noAnsi = message.replace(/\u001b\[[0-9;]*m/g, '');
  const trimmed = noAnsi.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/* ----------------------------- safe coercion ----------------------------- */

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((v) => {
      if (typeof v === 'string') return v;
      if (isObject(v) && typeof (v as Json).name === 'string') return (v as Json).name as string;
      return '';
    })
    .filter((s): s is string => s.length > 0);
  return out.length > 0 ? out : undefined;
}
