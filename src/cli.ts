#!/usr/bin/env node
/**
 * cli.ts — argument parsing (commander), pipeline orchestration, and exit codes.
 *
 * The single primary verb is `analyze`. The pipeline is:
 *   parse → score → detect flakiness → summarize → render → (optional) upload
 *
 * Exit codes:
 *   0  analysis completed (even with failing tests, even if upload was skipped
 *      or failed — upload is an enhancement, never a gate).
 *   1  a fatal input error (unreadable path / invalid JSON / unknown format).
 *
 * Rationale: this tool *analyzes* a test report; it is not the test runner, so a
 * red test is not a CLI error. CI consumers should read `--json` recommendations
 * to decide whether to block.
 */
import { Command } from 'commander';
import { loadDotenv, resolveConfig } from './config';
import { computeFlakeVerdicts, loadHistory } from './flakiness';
import { parseFile } from './parser';
import { renderJson, renderReport } from './report';
import { scoreFailures } from './scorer';
import { buildRecommendations, summarizeFailures } from './summarizer';
import { RunSignal, SignalError } from './types';
import { uploadRun } from './uploader';

export interface AnalyzeFlags {
  history: string;
  upload: boolean;
  json: boolean;
  color: boolean;
}

const DEFAULT_HISTORY_DIR = './fixtures/history';

/**
 * Run the offline pipeline (parse → score → flakiness → summarize) and return
 * the RunSignal *without* upload. Exported so tests can drive the pipeline
 * directly without spawning the process.
 */
export function buildSignal(reportPath: string, historyDir: string): { signal: RunSignal; historySkipped: { file: string; reason: string }[] } {
  const run = parseFile(reportPath);

  const history = loadHistory(historyDir);
  const flakeVerdicts = computeFlakeVerdicts(run, history.runs);
  const scoredFailures = scoreFailures(run, { flakeVerdicts });
  const summaries = summarizeFailures(scoredFailures, flakeVerdicts, { limit: 3 });
  const recommendations = buildRecommendations(scoredFailures, flakeVerdicts);

  return {
    signal: { run, scoredFailures, flakeVerdicts, summaries, recommendations },
    historySkipped: history.skipped,
  };
}

async function runAnalyze(reportPath: string, flags: AnalyzeFlags): Promise<number> {
  const useColor = flags.color && process.env.NO_COLOR == null;
  const { signal, historySkipped } = buildSignal(reportPath, flags.history || DEFAULT_HISTORY_DIR);

  // History parse problems are non-fatal but must be surfaced, never swallowed.
  if (historySkipped.length > 0 && !flags.json) {
    for (const s of historySkipped) {
      process.stderr.write(`warning: skipped history file "${s.file}" — ${s.reason}\n`);
    }
  }

  if (flags.upload) {
    // Load .env on demand so a project-root key works without exporting it.
    loadDotenv();
    const config = resolveConfig();
    signal.upload = await uploadRun(signal.run, config);
  }

  if (flags.json) {
    process.stdout.write(renderJson(signal) + '\n');
  } else {
    process.stdout.write(renderReport(signal, { useColor }) + '\n');
  }

  return 0;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('testrelic-signal')
    .description('Turn noisy Playwright/CTRF test results into actionable QA intelligence.')
    .version('1.0.0');

  program
    .command('analyze')
    .argument('<path-to-ctrf-or-playwright-json>', 'path to a CTRF or Playwright JSON report')
    .description('Analyze a test report: rank failures by business impact, flag flakes, summarize in plain English.')
    .option('--history <dir>', 'directory of prior runs for flakiness detection', DEFAULT_HISTORY_DIR)
    .option('--upload', 'opt-in: upload the report to TestRelic (requires TESTRELIC_API_KEY)', false)
    .option('--json', 'machine-readable output for CI', false)
    .option('--no-color', 'disable ANSI colors')
    .action(async (reportPath: string, opts: AnalyzeFlags) => {
      try {
        const code = await runAnalyze(reportPath, opts);
        process.exitCode = code;
      } catch (err) {
        printFatal(err);
        process.exitCode = 1;
      }
    });

  return program;
}

function printFatal(err: unknown): void {
  if (err instanceof SignalError) {
    process.stderr.write(`\nerror: ${err.message}\n`);
    if (err.remediation) process.stderr.write(`  → ${err.remediation}\n\n`);
  } else {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\nerror: unexpected failure — ${message}\n\n`);
  }
}

// Only auto-run when executed as a binary (not when imported by tests).
if (require.main === module) {
  buildProgram().parseAsync(process.argv).catch((err) => {
    printFatal(err);
    process.exit(1);
  });
}
