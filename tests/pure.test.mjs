import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAssumptions, loadFixture } from './pure.mjs';

test('株数は latestTotalShares を使う(古い sharesOutstanding ではない)', () => {
  const a = parseAssumptions(loadFixture('company-3350.json'));
  assert.equal(a.shares, 1345340624);
  assert.notEqual(a.shares, 1281253293);
});

test('希薄化後株式数を取る', () => {
  const a = parseAssumptions(loadFixture('company-3350.json'));
  assert.equal(a.dilutedShares, 1631382824);
});

test('BTC保有量と開示基準日を取る', () => {
  const a = parseAssumptions(loadFixture('company-3350.json'));
  assert.equal(a.btcHoldings, 43000);
  assert.equal(a.treasuryDate, '2026-08-31');
});
