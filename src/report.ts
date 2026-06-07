/**
 * report.ts — compact, scannable, founder-friendly terminal output.
 *
 * Renders: a one-line run summary, the top 1–3 critical failures (each with the
 * 4-line plain-English block), flaky-test candidates, recommendations, a clear
 * status line, and the TestRelic upload confirmation when --upload succeeded.
 *
 * Degrades cleanly: `--no-color` strips ANSI; `--json` emits a machine-readable
 * object for CI instead of the human view.
 */
import pc from 'picocolors';
import { RunSignal, Severity } from './types';

export interface RenderOptions {
  useColor: boolean;
  /** How many top failures to show with the full 4-line block (default 3). */
  topN?: number;
}

type Palette = {
  bold: (s: string) => string;
  dim: (s: string) => string;
  red: (s: string) => string;
  yellow: (s: string) => string;
  green: (s: string) => string;
  cyan: (s: string) => string;
  magenta: (s: string) => string;
};

function palette(useColor: boolean): Palette {
  const id = (s: string) => s;
  if (!useColor) {
    return { bold: id, dim: id, red: id, yellow: id, green: id, cyan: id, magenta: id };
  }
  return {
    bold: pc.bold,
    dim: pc.dim,
    red: pc.red,
    yellow: pc.yellow,
    green: pc.green,
    cyan: pc.cyan,
    magenta: pc.magenta,
  };
}

const SEVERITY_COLOR: Record<Severity, keyof Palette> = {
  critical: 'red',
  high: 'magenta',
  medium: 'yellow',
  low: 'dim',
};

export function renderReport(signal: RunSignal, options: RenderOptions): string {
  const c = palette(options.useColor);
  const topN = options.topN ?? 3;
  const lines: string[] = [];

  lines.push('');
  lines.push(c.bold('  TestRelic Signal — test results, translated into action'));
  lines.push(c.dim(`  source: ${signal.run.tool} · ${signal.run.tests.length} tests · ${formatTimestamp(signal.run.timestamp)}`));
  lines.push('');
  lines.push('  ' + summaryLine(signal, c));
  lines.push('');

  // Top failures (business-impact ranked).
  const top = signal.summaries.slice(0, topN);
  if (top.length > 0) {
    lines.push(c.bold(`  TOP ${top.length} FAILURE${top.length > 1 ? 'S' : ''} BY BUSINESS IMPACT`));
    lines.push('');
    top.forEach((summary, i) => {
      const scored = signal.scoredFailures[i];
      const sevColor = scored ? c[SEVERITY_COLOR[scored.severity]] : c.yellow;
      const badge = scored ? sevColor(`[${scored.severity.toUpperCase()} · score ${scored.score}]`) : '';
      lines.push(`  ${c.bold(`${i + 1}.`)} ${badge} ${c.bold(truncate(summary.test, 70))}`);
      lines.push(`     ${c.cyan('What failed:')}   ${summary.whatFailed}`);
      lines.push(`     ${c.cyan('Why it matters:')} ${summary.whyItMatters}`);
      lines.push(`     ${c.cyan('Flaky or real:')} ${verdictColored(summary.flakyOrReal, c)}`);
      lines.push(`     ${c.cyan('Do next:')}       ${summary.whatToDoNext}`);
      lines.push('');
    });
  } else {
    lines.push(c.green('  No hard failures detected. ✓'));
    lines.push('');
  }

  // Flaky candidates.
  const flaky = signal.flakeVerdicts.filter((v) => v.verdict === 'likely-flaky');
  if (flaky.length > 0) {
    lines.push(c.bold('  FLAKY-TEST CANDIDATES (noise, not blockers)'));
    for (const v of flaky) {
      lines.push(`  ${c.yellow('~')} ${truncate(v.test, 70)} ${c.dim(`(${Math.round(v.confidence * 100)}%) — ${v.evidence}`)}`);
    }
    lines.push('');
  }

  // Recommendations.
  if (signal.recommendations.length > 0) {
    lines.push(c.bold('  RECOMMENDATIONS'));
    for (const rec of signal.recommendations) {
      const colored = /BLOCK THE DEPLOY/.test(rec) ? c.red(rec) : rec;
      lines.push(`  ${c.bold('›')} ${colored}`);
    }
    lines.push('');
  }

  // Status + upload line.
  lines.push('  ' + statusLine(signal, c));
  lines.push('  ' + uploadLine(signal, c));
  lines.push('');

  return lines.join('\n');
}

function summaryLine(signal: RunSignal, c: Palette): string {
  const t = signal.run.totals;
  const parts = [
    c.green(`${t.passed} passed`),
    t.failed > 0 ? c.red(`${t.failed} failed`) : c.dim('0 failed'),
    t.flaky > 0 ? c.yellow(`${t.flaky} flaky`) : c.dim('0 flaky'),
    c.dim(`${t.skipped} skipped`),
  ];
  const totalMs = signal.run.tests.reduce((sum, x) => sum + x.durationMs, 0);
  return `${parts.join(' · ')} · ${formatDuration(totalMs)}`;
}

function statusLine(signal: RunSignal, c: Palette): string {
  const realBugs = signal.flakeVerdicts.filter((v) => v.verdict === 'likely-real-bug').length;
  const criticalRealBugs = signal.scoredFailures.filter(
    (f) => f.severity === 'critical' && signal.flakeVerdicts.find((v) => v.test === f.test.name)?.verdict === 'likely-real-bug'
  ).length;

  if (criticalRealBugs > 0) {
    return c.red(c.bold(`✗ ACTION REQUIRED: ${criticalRealBugs} critical real-bug failure(s) on a revenue/access path.`));
  }
  if (realBugs > 0) {
    return c.yellow(c.bold(`! ${realBugs} likely-real-bug failure(s) to fix — none critical.`));
  }
  if (signal.run.totals.failed > 0) {
    return c.yellow('! Failures present, but they look like flake/low-impact — verify before blocking.');
  }
  return c.green(c.bold('✓ Clean signal — no real-bug failures detected.'));
}

function uploadLine(signal: RunSignal, c: Palette): string {
  const upload = signal.upload;
  if (!upload) return c.dim('↑ Upload: not requested (run with --upload to send to TestRelic).');
  if (upload.uploaded) {
    return c.green(`↑ Uploaded to TestRelic → ${upload.dashboardUrl ?? 'dashboard'}`);
  }
  return c.yellow(`↑ Upload skipped/failed (non-fatal): ${upload.reason}`);
}

function verdictColored(text: string, c: Palette): string {
  if (/REAL BUG/i.test(text)) return c.red(text);
  if (/FLAKY/i.test(text)) return c.yellow(text);
  return c.dim(text);
}

/** Machine-readable output for CI (`--json`). */
export function renderJson(signal: RunSignal): string {
  return JSON.stringify(
    {
      tool: signal.run.tool,
      timestamp: signal.run.timestamp,
      totals: signal.run.totals,
      topFailures: signal.scoredFailures.map((f) => ({
        test: f.test.name,
        severity: f.severity,
        score: f.score,
        matchedCategory: f.matchedCategory,
        whyItMatters: f.whyItMatters,
        affectedUsers: f.affectedUsers,
        modifiers: f.modifiers,
      })),
      flakeVerdicts: signal.flakeVerdicts,
      summaries: signal.summaries,
      recommendations: signal.recommendations,
      upload: signal.upload ?? { uploaded: false, reason: 'not requested' },
    },
    null,
    2
  );
}

/* ----------------------------- formatting ----------------------------- */

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return 'time unknown';
  return d.toISOString().replace('T', ' ').replace(/\..+/, ' UTC');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
