# Part 3 evidence — capture with real TestRelic data

Graders verify these are **real ingested runs**, not mocks. After you have `TESTRELIC_API_KEY`:

1. `cp .env.example .env` and set your key.
2. `npm run test:e2e` — confirm a run appears on [platform.testrelic.ai](https://platform.testrelic.ai).
3. Save **`dashboard.png`** — Test Runs view (e.g. Run #3, checkout tax failure visible).
4. Open the failing checkout session → save **`ai-failure-analysis.png`** (session view with failure steps / AI insight).
5. **NL query screenshot** → **`mcp-query.png`**:
   - **Preferred:** [TestRelic MCP](https://docs.testrelic.ai/mcp/overview) in Cursor (`testrelic-mcp`, `tr_mcp_*` token).
   - **Fallback (if MCP package fails with `Cannot find module 'ajv'`):** [Ask AI](https://platform.testrelic.ai/ai) — ask *"What is the highest business impact failure in my latest test run?"* and screenshot prompt + response.

Place all three PNGs in this `docs/` folder. Filenames must match README links exactly:

- `dashboard.png`
- `ai-failure-analysis.png`
- `mcp-query.png`

See the root README **TestRelic MCP — known issue** section for the dependency error details and why Ask AI is an acceptable substitute.
