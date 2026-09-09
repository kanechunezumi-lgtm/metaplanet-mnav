import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAssumptions, parseStockPrice, loadFixture } from './pure.mjs';

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

function broken(mutate) {
  const f = loadFixture('company-3350.json');
  mutate(f.companies['3350.T'].processedMetrics);
  return parseAssumptions(f);
}

test('フィールドが欠けたら全体を捨てる(部分採用しない)', () => {
  assert.equal(broken(m => { delete m.latestDebt; }), null);
  assert.equal(broken(m => { delete m.latestTotalShares; }), null);
  assert.equal(broken(m => { delete m.latestBtcBalance; }), null);
  assert.equal(broken(m => { delete m.preferredStocks; }), null);
});

test('希薄化後株式数が発行済を下回ったら捨てる', () => {
  assert.equal(broken(m => { m.latestDilutedShares = 1000; }), null);
});

test('BTC保有量が現実的な範囲外なら捨てる', () => {
  assert.equal(broken(m => { m.latestBtcBalance = 0; }), null);
  assert.equal(broken(m => { m.latestBtcBalance = 5000000; }), null);
});

test('反転後の為替が範囲外なら捨てる', () => {
  // fxRate 0.001 は jpyPerUsd 1000 に相当する
  assert.equal(broken(m => { m.currencyInfo.fxRate = 0.001; }), null);
  assert.equal(broken(m => { m.currencyInfo.fxRate = 0.5; }), null);
});

test('開示基準日が欠けたら捨てる', () => {
  assert.equal(broken(m => { delete m.latestTreasuryDate; }), null);
});

test('開示基準日がキャッシュより古ければ捨てる(データの逆行)', () => {
  const f = loadFixture('company-3350.json');
  assert.equal(parseAssumptions(f, '2026-09-30'), null);
  assert.ok(parseAssumptions(f, '2026-08-31'));
  assert.ok(parseAssumptions(f, '2026-06-30'));
});

test('正常な fixture は通る', () => {
  assert.ok(parseAssumptions(loadFixture('company-3350.json')));
});

test('3350.T の円建て株価を取る', () => {
  assert.equal(parseStockPrice(loadFixture('prices-live.json')), 255);
});

test('priceUsd を拾っていない', () => {
  const v = parseStockPrice(loadFixture('prices-live.json'));
  assert.notEqual(v, 1.66232205);
  assert.ok(v > 10, `株価が USD 建てになっている: ${v}`);
});

test('通貨が JPY でなければ捨てる', () => {
  const f = loadFixture('prices-live.json');
  f.prices['3350.T'].currency = 'USD';
  assert.ok(Number.isNaN(parseStockPrice(f)));
});

test('3350.T が無ければ捨てる', () => {
  const f = loadFixture('prices-live.json');
  delete f.prices['3350.T'];
  assert.ok(Number.isNaN(parseStockPrice(f)));
});

test('価格が 0 以下なら捨てる', () => {
  const f = loadFixture('prices-live.json');
  f.prices['3350.T'].price = 0;
  assert.ok(Number.isNaN(parseStockPrice(f)));
});
