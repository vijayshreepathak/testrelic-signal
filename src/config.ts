/**
 * config.ts — environment + flag resolution and secret redaction.
 *
 * The only secret we ever touch is TESTRELIC_API_KEY. It is resolved here once
 * and redacted everywhere it might be logged. The CLI core never requires it —
 * see uploader.ts for the graceful-degradation contract.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ResolvedConfig {
  /** Raw API key (never log this directly — use redactKey). */
  apiKey?: string;
  /** Project / repo name tag attached to uploads, if provided. */
  project?: string;
  /**
   * CTRF-compatible REST endpoint base for the CLI's own report upload.
   * Confirmed base from docs.testrelic.ai: https://platform.testrelic.ai/api/v1
   */
  endpoint: string;
}

export const DEFAULT_ENDPOINT = 'https://platform.testrelic.ai/api/v1';

/**
 * Minimal, dependency-free `.env` loader. We only need `KEY=value` lines so a
 * full dotenv dependency would be scope creep. Existing process.env values win
 * (so `$env:TESTRELIC_API_KEY=...` overrides the file). Quotes and `#` comments
 * are handled; malformed lines are skipped silently rather than throwing.
 */
export function loadDotenv(path = resolve(process.cwd(), '.env')): void {
  if (!existsSync(path)) return;
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      // Strip trailing inline comments on unquoted values: KEY=val # note
      const hashIdx = value.indexOf(' #');
      if (hashIdx >= 0) value = value.slice(0, hashIdx).trim();
    }
    process.env[key] = value;
  }
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const apiKey = clean(env.TESTRELIC_API_KEY);
  const project = clean(env.TESTRELIC_PROJECT);
  const endpoint = clean(env.TESTRELIC_CLOUD_ENDPOINT) || DEFAULT_ENDPOINT;
  return { apiKey, project, endpoint };
}

function clean(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Redact a secret for safe logging. Shows only enough to confirm *which* key is
 * in use without leaking it: "tr_li…a9f2" → never the full value.
 */
export function redactKey(key: string | undefined): string {
  if (!key) return '(none)';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/**
 * Redact any occurrence of the live key inside an arbitrary string (used to
 * scrub error bodies / stack traces before they are printed).
 */
export function redactSecretsIn(text: string, key: string | undefined): string {
  if (!key || key.length < 6) return text;
  return text.split(key).join('[REDACTED_API_KEY]');
}
