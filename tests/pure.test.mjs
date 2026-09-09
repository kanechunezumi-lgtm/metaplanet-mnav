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

test('有利子負債を円に換算する(latestDebt は USD 建て)', () => {
  const a = parseAssumptions(loadFixture('company-3350.json'));
  // 464,065,700 USD ÷ 0.00652137 = 71,160,768,366 円
  assert.ok(Math.abs(a.debt - 71160768366) < 1, `debt=${a.debt}`);
});

test('為替を掛ける向きを間違えていない', () => {
  const a = parseAssumptions(loadFixture('company-3350.json'));
  // 向きを誤ると ¥302万 か ¥7.1京 になる。¥712億前後であることを固定する。
  assert.ok(a.debt > 7.0e10 && a.debt < 7.3e10, `debt=${a.debt}`);
});

test('優先株は notionalMillions(円・百万)から円に直す', () => {
  const a = parseAssumptions(loadFixture('company-3350.json'));
  assert.equal(a.preferred, 23610000000);
  // notionalUSD (153,969,545.7) を拾っていないこと
  assert.notEqual(Math.round(a.preferred), 153969546);
});

test('優先株が複数あれば合算し、USD建ての要素は換算する', () => {
  const f = loadFixture('company-3350.json');
  f.companies['3350.T'].processedMetrics.preferredStocks.push({
    ticker: 'TEST', notionalMillions: 100.0, notionalUSD: 10000000, currency: 'USD'
  });
  const a = parseAssumptions(f);
  // 23,610,000,000 + 10,000,000 USD × 153.34201249 = 25,143,420,125
  assert.ok(Math.abs(a.preferred - 25143420125) < 2, `preferred=${a.preferred}`);
});
