# Part 4 — Scale thinking (TestRelic Signal)

## Deployment Playbook (next 50 customers)

| Step | Action | Owner |
|------|--------|-------|
| 1 | Sign up at testrelic.ai, complete onboarding wizard (framework = Playwright). | Customer admin |
| 2 | Create API key in Settings → API Keys; add repo in All Repos. | Admin |
| 3 | `npm install @testrelic/playwright-analytics`; wire reporter per docs (`upload: 'both'`, `endpoint: https://platform.testrelic.ai/api/v1`). | Dev |
| 4 | Set `TESTRELIC_API_KEY` in CI secrets + local `.env`; run `npx playwright test`. | Dev |
| 5 | Confirm run in Test Runs dashboard; open failing session for AI insight. | Dev lead |
| 6 | Install TestRelic MCP (`testrelic-mcp` plugin or `npx @testrelic/mcp`), set `tr_mcp_*` token, run first NL query. | Dev |
| 7 | Add `testrelic-signal analyze <report.json> --history ./history` in CI post-test step for offline triage. | Dev |

**Drop-off points & mitigations**

| Drop-off | Symptom | Mitigation |
|----------|---------|------------|
| Key never set | Empty dashboard, “it works locally” | Post-install checklist in README; CLI warning on `--upload`; CI step that fails *only* the upload annotation, not the build, with link to docs. |
| Reporter wired, CI secret missing | Local uploads work; CI has no runs | Template `ci.yml` with `TESTRELIC_API_KEY: ${{ secrets.TESTRELIC_API_KEY }}`; onboarding email day-2 nudge. |
| First run all green | No “aha” moment | Ship a seeded demo repo (this project) with one intentional checkout bug so first run shows AI failure analysis. |
| History not retained | Flake verdicts stuck at `insufficient-history` | Document `--history` dir; CI artifact retention for last 5 `playwright-report.json` files. |

## Top 3 Integration Failure Patterns

### 1. `TESTRELIC_API_KEY` unset

- **Symptom:** CI green; Test Runs empty; reporter may print nothing alarming; dev assumes analytics are on.
- **Resolution:** (1) Create key in platform Settings. (2) Add secret to GitHub Actions / local `.env`. (3) Re-run tests; look for `Run uploaded` or CLI `↑ Uploaded to TestRelic`.

### 2. Reporter misconfigured

- **Symptom:** `Error: Cannot find module '@testrelic/playwright-analytics'` or `Reporter "@testrelic/playwright-analytics" not found`.
- **Resolution:** (1) `npm install @testrelic/playwright-analytics` in the same package as `@playwright/test`. (2) Use string form `['@testrelic/playwright-analytics', { ... }]` in `reporter` array. (3) Pin versions in lockfile.

### 3. Results upload but dashboard shows 0 tests / empty steps

- **Symptom:** Run row exists; test count 0 or Steps tab empty.
- **Resolution:** (1) Set `cloud.upload: 'both'` (not `realtime` alone—docs warn batch payload is required for full views). (2) Confirm `outputPath` artifact exists after run. (3) For sharded CI, merge with `@testrelic/playwright-analytics/merge` before upload.

## Feedback Loop Design

| Event | Why instrument |
|-------|----------------|
| `sdk_installed` | Funnel start |
| `first_run_uploaded` | Activation gate |
| `first_insight_viewed` | Value moment (AI or summary opened) |
| `first_mcp_query` | Deep integration |
| `failure_actioned` | Outcome (commit/issue within 24h of flagged critical failure) |

**Activation threshold:** first successful upload **and** first AI/summary insight viewed **and** first follow-up MCP query within **7 days**. The triple proves ingest + comprehension + workflow embed—not vanity page views.

## One Product Insight

**Problem:** The SDK/reporter path can silently skip cloud upload when the API key is missing, so teams believe they are covered while the dashboard stays empty.

**Proposed solution:** Startup “dry-run detection”—if `TESTRELIC_API_KEY` is unset at reporter init, emit a CI annotation / stderr banner: *“TestRelic cloud upload disabled; set TESTRELIC_API_KEY.”* Mirror the CLI uploader’s explicit skip message.

**Evidence:** Building `uploader.ts` required the same defensive warning to meet the assignment’s graceful-degradation bar; without it, `npm run analyze` looked successful while upload never happened. The friction is real and repeatable across customers.
