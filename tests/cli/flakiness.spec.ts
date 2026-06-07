import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { computeFlakeVerdicts, loadHistory } from '../../src/flakiness';
import { parseFile } from '../../src/parser';

const root = join(__dirname, '..', '..');

test.describe('flakiness', () => {
  test('classifies alternating search test as likely-flaky', () => {
    const current = parseFile(join(root, 'fixtures', 'ctrf-valid.json'));
    const history = loadHistory(join(root, 'fixtures', 'history'));
    const verdicts = computeFlakeVerdicts(current, history.runs);
    const search = verdicts.find((v) => v.test.includes('search results'));
    expect(search?.verdict).toBe('likely-flaky');
    expect(search?.evidence).toMatch(/failed|flip|intermittent|retry/i);
  });

  test('classifies consistent checkout tax failure as likely-real-bug', () => {
    const current = parseFile(join(root, 'fixtures', 'ctrf-valid.json'));
    const history = loadHistory(join(root, 'fixtures', 'history'));
    const verdicts = computeFlakeVerdicts(current, history.runs);
    const checkout = verdicts.find((v) => v.test.includes('sales tax'));
    expect(checkout?.verdict).toBe('likely-real-bug');
    expect(checkout?.evidence).toMatch(/failed all|consistent|failed \d+\/\d+/i);
  });

  test('returns insufficient-history with thin evidence', () => {
    const current = parseFile(join(root, 'fixtures', 'ctrf-valid.json'));
    const verdicts = computeFlakeVerdicts(current, []);
    const footer = verdicts.find((v) => v.test.includes('copyright'));
    expect(footer?.verdict).toBe('insufficient-history');
  });
});
