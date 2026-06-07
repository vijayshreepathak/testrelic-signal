import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { parseFile } from '../../src/parser';
import { scoreFailures, SEVERITY_WEIGHTS } from '../../src/scorer';

const root = join(__dirname, '..', '..');

test.describe('scorer', () => {
  test('checkout failure outranks cosmetic failure', () => {
    const run = parseFile(join(root, 'fixtures', 'ctrf-valid.json'));
    const scored = scoreFailures(run);
    expect(scored.length).toBeGreaterThanOrEqual(2);
    const checkout = scored.find((s) => s.test.name.includes('sales tax'));
    const footer = scored.find((s) => s.test.name.includes('copyright'));
    expect(checkout).toBeDefined();
    expect(footer).toBeDefined();
    expect(checkout!.score).toBeGreaterThan(footer!.score);
    expect(checkout!.severity).toBe('critical');
    expect(footer!.severity).toBe('low');
    expect(scored[0].test.name).toBe(checkout!.test.name);
  });

  test('exports tunable weight table', () => {
    expect(SEVERITY_WEIGHTS.critical).toBe(3);
    expect(SEVERITY_WEIGHTS.low).toBe(0.5);
  });
});
