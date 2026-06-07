# Part 1 — Problem diagnosis (TestRelic Signal)

## Root Cause Analysis

The customer asked for “a better report” and “plain-English failures.” Those are **symptoms**. The root cause is sharper: **test results are invisible to the people who can act on them, and undifferentiated when they are found.** CI stores Playwright output in GitHub Actions artifacts; no developer opens them unless the build is already red—and even then, every failure looks equally urgent. Flaky timeouts and a checkout tax bug share the same red badge, so teams either block deploys on noise or ship past real regressions. Without a QA function, there is no triage layer—developers own testing but not test *interpretation*. The fix is not another HTML report; it is **signal extraction at the moment of failure**: business impact ranking, flake vs. bug separation, and one concrete next step—offline-first, with TestRelic as an enhancement when keys exist.

## Jobs-to-be-Done

**Functional**

1. When CI fails on my PR, I want to know in one line whether it is a real bug or flake, so I can decide whether to block the merge.
2. When I open a test report, I want failures ranked by what breaks revenue or access (login, checkout), so I fix what matters first.
3. When I have five historical runs, I want the tool to cite pass/fail patterns as evidence, so I do not re-triage the same intermittent test every sprint.

**Emotional**

4. When I ship on Friday, I want to trust the failure summary instantly, so I do not feel anxious that we missed a payment-path regression.

## Failure Modes at Scale (200 teams)

| Mode | Mitigation in this solution |
|------|------------------------------|
| **Silent upload** — `TESTRELIC_API_KEY` unset; reporter or CLI no-ops; dashboard empty while CI is green. | CLI uploader logs a **loud, non-fatal** warning with `.env` setup steps; never exit 1 on upload skip. Reporter uses documented `cloud.apiKey` from env. |
| **Schema drift** — Playwright/CTRF JSON shapes change across versions. | Tolerant parser with format auto-detect, safe defaults for null/missing fields, typed `SignalError` for true parse failures only. |
| **Flake false positives** — thin history causes confident wrong verdicts. | `insufficient-history` verdict when &lt;3 observations; evidence strings cite actual run counts. |

## Success Metric

**Time from CI fail to first human triage action** (re-run, fix commit, or documented dismissal), measured as median minutes from workflow failure to the next related commit or issue comment on that test name.

TestRelic surfaces this via run timestamps + linked Jira/GitHub activity on the same failure fingerprint; the CLI’s `--json` recommendations give CI a machine hook to annotate PRs when `likely-real-bug` + `critical` is detected.
