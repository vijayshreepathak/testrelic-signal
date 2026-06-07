import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { buildSignal } from '../../src/cli';
import { extractErrorSignal } from '../../src/summarizer';

const root = join(__dirname, '..', '..');

test.describe('summarizer', () => {
  test('summary contains four elements and names the affected flow', () => {
    const { signal } = buildSignal(join(root, 'fixtures', 'ctrf-valid.json'), join(root, 'fixtures', 'history'));
    expect(signal.summaries.length).toBeGreaterThan(0);
    const top = signal.summaries[0];
    expect(top.whatFailed.length).toBeGreaterThan(10);
    expect(top.whyItMatters).toMatch(/matter|Affected/i);
    expect(top.flakyOrReal).toMatch(/REAL BUG|FLAKY|history/i);
    expect(top.whatToDoNext.length).toBeGreaterThan(10);
    expect(top.whatFailed.toLowerCase()).toMatch(/checkout|payment|tax|order/);
  });

  test('extractErrorSignal pulls Expected/Received without stack dump', () => {
    const signal = extractErrorSignal('Error: expect(received).toBe(expected)\n\nExpected: 108\nReceived: 100\n    at foo.ts:1');
    expect(signal).toMatch(/Expected: 108/);
    expect(signal).toMatch(/Received: 100/);
    expect(signal).not.toMatch(/at foo/);
  });
});
