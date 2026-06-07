# Part 3 evidence — capture with real TestRelic data

Graders verify these are **real ingested runs**, not mocks. After you have `TESTRELIC_API_KEY`:

1. `cp .env.example .env` and set your key.
2. `npm run test:e2e` — confirm a run appears on [platform.testrelic.ai](https://platform.testrelic.ai).
3. Save **`dashboard.png`** — Test Runs view (e.g. Run #3, checkout tax failure visible).
4. Open the failing checkout session → save **`ai-failure-analysis.png`** (session view with failure steps / AI insight).
5. **Ask AI screenshot** → **`mcp-query.png`**: open [Ask AI](https://platform.testrelic.ai/ai), ask *"What is the highest business impact failure in my latest test run?"*, and screenshot prompt + response.

Place all three PNGs in this `docs/` folder. Filenames must match README links exactly:

- `dashboard.png`
- `ai-failure-analysis.png`
- `mcp-query.png`
