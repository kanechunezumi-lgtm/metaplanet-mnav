# mNAV電卓 前提条件の自動取得 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 前提条件(株数・BTC保有量・有利子負債・優先株)と3350の株価を `data.strategytracker.com` から自動取得し、古い数字を黙って表示する状態をなくす。

**Architecture:** `index.html` 単一ファイルのまま、ページから直接 CORS 開放済みの静的 JSON を読む。パース・検証・単位換算をマーカーで囲んだ純粋関数に切り出し、Node 標準の `node --test` で `index.html` から切り出して検証する。取得失敗時はキャッシュ → ハードコード値へ後退し、どの段にいるかを画面に出す。

**Tech Stack:** 素の JavaScript(ES5相当、ビルドなし)、`fetch` + `AbortController`、`localStorage`、テストは Node 24 の `node:test` + `node:vm`。

## Global Constraints

- 依存パッケージを追加しない。`package.json` を作らない。配布物は `index.html` 1枚のまま
- `index.html` はローカルでダブルクリックしても動くこと(相対パスの外部ファイルに依存しない)
- 既存のコードスタイルに合わせる: `var` 宣言、`function` 式、ES5 相当の構文、日本語コメントは「なぜ」を書く
- BTC価格の取得系(`SOURCES` / CoinGecko / Kraken)には手を入れない
- 倍率の表示は切り捨て2桁(`fmtMultiple`)、プレミアム率は切り捨て前の値から計算(既存の挙動を維持)
- 為替は `jpyPerUsd = 1 / currencyInfo.fxRate` に一本化する。生の `fxRate` を直接掛けない
- 検証は全部かゼロか。1項目でも落ちたら payload 全体を破棄する
- コミットメッセージ末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## File Structure

| ファイル | 責務 |
|---|---|
| `index.html`(変更) | ページ全体。`PURE:BEGIN`〜`PURE:END` に純粋関数、その外に DOM 配線と取得層 |
| `tests/fixtures/company-3350.json`(新規) | `3350_T.v{版数}.json` を必要フィールドまで削った固定スナップショット |
| `tests/fixtures/prices-live.json`(新規) | `prices-live.json` の 3350.T 部分の固定スナップショット |
| `tests/pure.mjs`(新規) | `index.html` からマーカー間を切り出して純粋関数を export するヘルパ |
| `tests/pure.test.mjs`(新規) | `node --test` で走る検証 |
| `README.md`(変更) | 自動取得の説明に更新。誤っている「残差 0.01 について」の節を書き直す |

---

## Task 1: テスト基盤と株数の抽出

**Files:**
- Create: `tests/fixtures/company-3350.json`
- Create: `tests/pure.mjs`
- Create: `tests/pure.test.mjs`
- Modify: `index.html`(`DEFAULTS` 定義の直後、現行 504行目あたりに純粋関数ブロックを新設)

**Interfaces:**
- Consumes: なし
- Produces: `PURE.parseAssumptions(json, prevTreasuryDate) -> object|null`。成功時の戻り値は
  `{ shares, dilutedShares, btcHoldings, debt, preferred, treasuryDate }`。
  `shares`/`dilutedShares` は株数、`btcHoldings` は BTC、`debt`/`preferred` は**円**、`treasuryDate` は `"YYYY-MM-DD"` 文字列。
  Task 2〜6 がこの形に依存する。

- [ ] **Step 1: fixture を置く**

`tests/fixtures/company-3350.json` を以下の内容で作成する。2026-09-09 に実際に取得したものを
必要フィールドまで削った固定スナップショット。**罠を再現するフィールド**(古い `sharesOutstanding`、
USD建ての `latestDebt`、逆向きの `preferredStocks[].fxRate`、`notionalUSD`)を意図的に残してある。

```json
{
  "companies": {
    "3350.T": {
      "processedMetrics": {
        "sharesOutstanding": 1281253293.0,
        "latestTotalShares": 1345340624,
        "latestDilutedShares": 1631382824,
        "latestBtcBalance": 43000.0,
        "latestDebt": 464065700.0,
        "latestTreasuryDate": "2026-08-31",
        "currencyInfo": {
          "originalCurrency": "JPY",
          "targetCurrency": "USD",
          "fxRate": 0.00652137,
          "conversionApplied": true
        },
        "preferredStocks": [
          {
            "ticker": "MERCURY",
            "name": "Class B Perpetual Convertible Preferred Shares",
            "notionalMillions": 23610.0,
            "notionalUSD": 153969545.7,
            "currency": "JPY",
            "fxRate": 153.34201249124033,
            "parValue": 1000.0,
            "dividendRate": 4.9,
            "isTraded": false
          }
        ]
      }
    }
  }
}
```

- [ ] **Step 2: 切り出しヘルパを書く**

`tests/pure.mjs`:

```js
// index.html は単一ファイルのまま配布したいので、テストからは
// PURE:BEGIN 〜 PURE:END の間だけを切り出して評価する。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, '..', 'index.html'), 'utf8');

const BEGIN = '/* --- PURE:BEGIN --- */';
const END = '/* --- PURE:END --- */';
const from = html.indexOf(BEGIN);
const to = html.indexOf(END);
if (from === -1 || to === -1 || to < from) {
  throw new Error('index.html に PURE:BEGIN / PURE:END マーカーが見つからない');
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext(html.slice(from + BEGIN.length, to), ctx);

export const parseAssumptions = ctx.PURE.parseAssumptions;
export const parseStockPrice = ctx.PURE.parseStockPrice;

export function loadFixture(name) {
  return JSON.parse(readFileSync(path.join(here, 'fixtures', name), 'utf8'));
}
```

- [ ] **Step 3: 失敗するテストを書く**

`tests/pure.test.mjs`:

```js
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
```

- [ ] **Step 4: 失敗を確認する**

Run: `node --test tests/`
Expected: FAIL — `index.html に PURE:BEGIN / PURE:END マーカーが見つからない`

- [ ] **Step 5: 純粋関数ブロックを新設する**

`index.html` の `DEFAULTS` オブジェクトの閉じ括弧 `};` の直後に挿入する。

```js
  // ここから PURE:END までは DOM に触れない純粋関数だけを置く。
  // tests/pure.mjs がこのマーカー間を切り出して node --test で検証する。
  /* --- PURE:BEGIN --- */
  var PURE = (function () {
    function num(v) {
      return (typeof v === 'number' && isFinite(v)) ? v : NaN;
    }

    // strategytracker の company JSON から前提条件を取り出す。
    // 検証に1項目でも落ちたら null を返す(部分採用しない)。
    function parseAssumptions(json, prevTreasuryDate) {
      var co = json && json.companies && json.companies['3350.T'];
      var m = co && co.processedMetrics;
      if (!m) return null;

      // 同じオブジェクトに sharesOutstanding があるが、そちらは開示より古い値。
      // 2026-09-09 時点で 1,281,253,293(実際は 1,345,340,624)だった。
      var shares = num(m.latestTotalShares);
      var dilutedShares = num(m.latestDilutedShares);
      var btcHoldings = num(m.latestBtcBalance);
      var treasuryDate = m.latestTreasuryDate;

      return {
        shares: shares,
        dilutedShares: dilutedShares,
        btcHoldings: btcHoldings,
        debt: NaN,
        preferred: NaN,
        treasuryDate: treasuryDate
      };
    }

    function parseStockPrice() { return NaN; }

    return { parseAssumptions: parseAssumptions, parseStockPrice: parseStockPrice };
  })();
  /* --- PURE:END --- */
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `node --test tests/`
Expected: 3 tests PASS

- [ ] **Step 7: コミット**

```bash
git add tests index.html
git commit -F - <<'MSG'
Add pure-function test harness and share-count parsing

index.html を単一ファイルのまま保つため、PURE マーカー間を node:vm で
切り出して node --test に食わせる方式にした。依存パッケージは足していない。

最初のテストは、古い sharesOutstanding ではなく latestTotalShares を
掴むことの回帰。今回の乖離の原因がまさにこれだった。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 2: 通貨換算(有利子負債と優先株)

**Files:**
- Modify: `index.html`(`parseAssumptions` 内)
- Modify: `tests/pure.test.mjs`

**Interfaces:**
- Consumes: Task 1 の `parseAssumptions(json, prevTreasuryDate)`
- Produces: 戻り値の `debt` と `preferred` が**円**で埋まる

- [ ] **Step 1: 失敗するテストを書く**

`tests/pure.test.mjs` の末尾に追加:

```js
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
```

- [ ] **Step 2: 失敗を確認する**

Run: `node --test tests/`
Expected: 4 FAIL(`debt` と `preferred` が `NaN`)

- [ ] **Step 3: 換算を実装する**

`parseAssumptions` 内の `var treasuryDate = m.latestTreasuryDate;` の直後に追加する。

```js
      // このファイルには向きの違う為替レートが2つ入っている。
      //   currencyInfo.fxRate      = 0.00652137  円 → ドル
      //   preferredStocks[].fxRate = 153.342     ドル → 円 (= 1/上、実測で完全一致)
      // 取り違えると桁が2万倍狂うので、正準を currencyInfo.fxRate に決めて
      // 一度だけ反転して使う。優先株が無い期には preferredStocks[] が存在しないため、
      // そちらの fxRate は参照しない。
      var fxRate = num(m.currencyInfo && m.currencyInfo.fxRate);
      var jpyPerUsd = fxRate > 0 ? 1 / fxRate : NaN;

      var debt = num(m.latestDebt) * jpyPerUsd;

      // 優先株は配列。将来増えても合算されるようにしておく。
      var preferred = 0;
      var list = m.preferredStocks || [];
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        var v = (p.currency === 'JPY')
          ? num(p.notionalMillions) * 1e6
          : num(p.notionalUSD) * jpyPerUsd;
        if (!isFinite(v)) { preferred = NaN; break; }
        preferred += v;
      }
```

同じ関数の `return` を次に差し替える(`debt: NaN, preferred: NaN` を実値に):

```js
      return {
        shares: shares,
        dilutedShares: dilutedShares,
        btcHoldings: btcHoldings,
        debt: debt,
        preferred: preferred,
        treasuryDate: treasuryDate
      };
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node --test tests/`
Expected: 7 tests PASS

- [ ] **Step 5: コミット**

```bash
git add index.html tests/pure.test.mjs
git commit -F - <<'MSG'
Convert debt and preferred stock to JPY

latestDebt は USD 建て、preferredStocks[].notionalMillions は円の百万単位、
という混在をここで吸収する。同じファイルに逆向きの為替レートが2つ入っており
取り違えると桁が2万倍狂うため、currencyInfo.fxRate を正準として
jpyPerUsd = 1/fxRate に一本化した。向きの回帰テストを付けてある。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 3: 検証(全部かゼロか)

**Files:**
- Modify: `index.html`(`parseAssumptions` 内)
- Modify: `tests/pure.test.mjs`

**Interfaces:**
- Consumes: Task 2 の `parseAssumptions`
- Produces: 検証に落ちたとき `null` を返す。第2引数 `prevTreasuryDate` によるデータ逆行の検知

- [ ] **Step 1: 失敗するテストを書く**

`tests/pure.test.mjs` の末尾に追加:

```js
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
```

- [ ] **Step 2: 失敗を確認する**

Run: `node --test tests/`
Expected: 検証系の 6 テストが FAIL(`null` ではなく `NaN` 入りのオブジェクトが返る)

- [ ] **Step 3: 検証を実装する**

`PURE` の IIFE 先頭、`function num(v)` の前に定数を置く:

```js
    // 明らかに壊れた値を弾くための範囲。既存の MIN_PLAUSIBLE と同じ考え方で
    // 実測値から十分に width を取る。
    var MIN_BTC = 1000, MAX_BTC = 1000000;
    var MIN_JPY_PER_USD = 50, MAX_JPY_PER_USD = 300;
```

`parseAssumptions` の `return { ... }` の直前に検証を挿入する:

```js
      // 全部かゼロか。新しいBTC保有量と古い株数が混ざった状態は、
      // 一貫して古いスナップショットより悪い数字を出す。
      if (!(shares > 0) || !(dilutedShares >= shares)) return null;
      if (!(btcHoldings >= MIN_BTC) || !(btcHoldings <= MAX_BTC)) return null;
      if (!(jpyPerUsd >= MIN_JPY_PER_USD) || !(jpyPerUsd <= MAX_JPY_PER_USD)) return null;
      if (!isFinite(debt) || debt < 0) return null;
      if (!isFinite(preferred) || preferred < 0) return null;
      if (typeof treasuryDate !== 'string' || !treasuryDate) return null;
      // 日付は YYYY-MM-DD 固定なので文字列比較でよい
      if (prevTreasuryDate && treasuryDate < prevTreasuryDate) return null;
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node --test tests/`
Expected: 14 tests PASS

- [ ] **Step 5: コミット**

```bash
git add index.html tests/pure.test.mjs
git commit -F - <<'MSG'
Validate assumptions payload, all-or-nothing

1項目でも検証に落ちたら payload 全体を捨てる。新しいBTC保有量と
古い株数が混ざった状態は、一貫して古いスナップショットより悪い。

開示基準日がキャッシュより古い場合も捨てる。本家側が巻き戻ったときの保険。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 4: 株価のパース

**Files:**
- Create: `tests/fixtures/prices-live.json`
- Modify: `index.html`(`PURE` 内の `parseStockPrice`)
- Modify: `tests/pure.test.mjs`

**Interfaces:**
- Consumes: なし
- Produces: `PURE.parseStockPrice(json) -> number`(円)。失敗時は `NaN`

- [ ] **Step 1: fixture を置く**

`tests/fixtures/prices-live.json`:

```json
{
  "prices": {
    "3350.T": {
      "price": 255,
      "previousClose": 244,
      "change": 11,
      "changePercent": 4.5082,
      "priceUsd": 1.66232205,
      "currency": "JPY",
      "fxRate": 0.00651891,
      "volume": 37548100,
      "timestamp": 1788930620,
      "exchange": "JPX"
    },
    "MSTR": { "price": 180.5, "currency": "USD", "priceUsd": 180.5 }
  },
  "metadata": { "timestamp": "2026-09-09T05:10:20.000000+00:00" }
}
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/pure.test.mjs` の import 行を差し替える:

```js
import { parseAssumptions, parseStockPrice, loadFixture } from './pure.mjs';
```

末尾に追加:

```js
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
```

- [ ] **Step 3: 失敗を確認する**

Run: `node --test tests/`
Expected: 株価系の 5 テストのうち少なくとも 2 つが FAIL

- [ ] **Step 4: 実装する**

`PURE` 内の `function parseStockPrice() { return NaN; }` を差し替える:

```js
    // 同じオブジェクトに priceUsd(1.66)が並んでいる。取り違えると
    // mNAV が 0.004 になるので、通貨を確認してからでないと price を使わない。
    function parseStockPrice(json) {
      var p = json && json.prices && json.prices['3350.T'];
      if (!p || p.currency !== 'JPY') return NaN;
      var v = num(p.price);
      return v > 0 ? v : NaN;
    }
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `node --test tests/`
Expected: 19 tests PASS

- [ ] **Step 6: コミット**

```bash
git add index.html tests/
git commit -F - <<'MSG'
Parse live stock price for 3350.T

prices-live.json には price(円 255)と priceUsd(1.66)が並んでいる。
取り違えると mNAV が 0.004 になるため、currency === 'JPY' を確認してから
price を使う。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 5: localStorage キャッシュ

**Files:**
- Modify: `index.html`(`PURE:END` の直後)

**Interfaces:**
- Consumes: Task 3 の `parseAssumptions` の戻り値の形
- Produces: `readCache() -> object|null`、`writeCache(a)`。`a` は `parseAssumptions` の戻り値に
  `fetchedAt`(ISO文字列)と `version`(文字列)を足したもの

このタスクは `localStorage` に触るため純粋関数ブロックの外に置く。単体テストは書かず、
Task 6 の手動確認でまとめて見る。

- [ ] **Step 1: キャッシュ層を実装する**

`/* --- PURE:END --- */` の直後に挿入する:

```js
  // 808KB の生JSONは保存しない。抽出後の数値だけを持つ。
  var CACHE_KEY = 'mnav.assumptions.v1';

  // プライベートウィンドウやサイトデータ拒否の設定では読み書き自体が
  // 例外を投げる。描画を止めないよう常に握りつぶす。
  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var a = JSON.parse(raw);
      return (a && a.shares > 0 && a.treasuryDate) ? a : null;
    } catch (e) { return null; }
  }

  function writeCache(a) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(a)); } catch (e) { /* 保存できなくても動く */ }
  }
```

- [ ] **Step 2: ブラウザで手動確認する**

`index.html` をブラウザで開き、DevTools のコンソールで:

```js
localStorage.setItem('mnav.assumptions.v1', JSON.stringify({shares: 1, treasuryDate: '2026-01-01'}));
```

を実行してからリロードし、コンソールにエラーが出ないことを確認する。確認後:

```js
localStorage.removeItem('mnav.assumptions.v1');
```

- [ ] **Step 3: コミット**

```bash
git add index.html
git commit -F - <<'MSG'
Add localStorage cache for assumptions

808KB の生JSONではなく抽出後の数値だけを持つ。プライベートウィンドウでは
localStorage のアクセス自体が例外を投げるので、読み書きとも握りつぶして
描画を止めない。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 6: 取得層の配線

**Files:**
- Modify: `index.html`(`fetchJson` / 定数 / 状態変数 / 取得関数 / 起動シーケンス)

**Interfaces:**
- Consumes: `PURE.parseAssumptions`、`PURE.parseStockPrice`、`readCache`、`writeCache`
- Produces: `fetchAssumptions() -> Promise<object>`、`fetchStockPrice() -> Promise<number>`、
  `applyAssumptions(a, state)`、`refreshAssumptions(force)`、`refreshStockPrice()`。
  `state` は `'live'` / `'cache'` / `'fallback'` のいずれか。
  モジュール変数 `dilutedShares`(数値)、`assumpState`、`assumpMeta`、`stockSource`、`stockError` を
  Task 7・8 が読む。

- [ ] **Step 1: `DEFAULTS` に2つのキーを足す**

このタスクと Task 8 が `DEFAULTS.dilutedShares` と `DEFAULTS.treasuryDate` を読む。
値の全面更新は Task 9 で行うので、ここではキーの追加だけをする。

`DEFAULTS` の `shares: 1345352000,` の直後に:

```js
    dilutedShares: 1631382824,
```

`preferred: 23600000000` の後ろにカンマを足し、その直後に:

```js
    treasuryDate: '2026-08-31'
```

- [ ] **Step 2: `fetchJson` にキャッシュモードを足す**

`3350_T.v{版数}.json` は `Cache-Control: immutable` なので、ブラウザの HTTP キャッシュを
効かせたい。現行の `cache: 'no-store'` 固定を引数化する。

`fetchJson` を差し替える:

```js
  function fetchJson(url, cacheMode) {
    var ctrl = new AbortController();
    var to = setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT_MS);
    return fetch(url, { signal: ctrl.signal, cache: cacheMode || 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .finally(function () { clearTimeout(to); });
  }
```

既存の呼び出し3箇所(CoinGecko、Kraken、ExchangeRate)は引数なしのままでよい。

- [ ] **Step 3: 定数と状態変数を足す**

`var REFRESH_MS = 60000;` の直後に:

```js
  var ST_BASE = 'https://data.strategytracker.com/';
  // 前提条件が動くのは開示があったときだけ。版数は15分ごとに上がるが、
  // 中身が同じなのに808KBを引き直す意味はない。
  var ASSUMPTIONS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
```

`var inFlight = false;` の直後に:

```js
  var dilutedShares = DEFAULTS.dilutedShares;
  var assumpState = 'fallback';   // 'live' | 'cache' | 'fallback'
  var assumpMeta = null;          // { treasuryDate, fetchedAt }
  var assumpInFlight = false;
  var stockSource = null;         // 取得できた時刻。null なら未取得
  var stockError = false;
```

- [ ] **Step 4: 取得関数を書く**

`fetchNow` 関数の直前に挿入する:

```js
  // latest.json (283B) で版数を得てから、版数付きの本体を取りに行く。
  // 版数なしの 3350_T.json は 403 になるのでこの2段は省略できない。
  function fetchAssumptions() {
    return fetchJson(ST_BASE + 'latest.json').then(function (j) {
      var v = j && j.version;
      if (!v) throw new Error('no version');
      return fetchJson(ST_BASE + '3350_T.v' + v + '.json', 'default').then(function (co) {
        var prev = assumpMeta ? assumpMeta.treasuryDate : null;
        var a = PURE.parseAssumptions(co, prev);
        if (!a) throw new Error('assumptions failed validation');
        a.version = v;
        a.fetchedAt = new Date().toISOString();
        return a;
      });
    });
  }

  function fetchStockPrice() {
    return fetchJson(ST_BASE + 'prices-live.json').then(function (j) {
      var v = PURE.parseStockPrice(j);
      if (!isFinite(v)) throw new Error('bad stock price');
      return v;
    });
  }
```

- [ ] **Step 5: 反映関数を書く**

上の直後に挿入する。`manual` は Task 8 で導入するので、ここでは未定義でも動くよう
`typeof` で防御しておく。Task 8 を終えると条件が効き始める。

```js
  // .value への代入は input イベントを発火しないので、手動入力とは区別される
  function setIfAuto(el, key, value) {
    if (typeof manual !== 'undefined' && manual[key]) return;
    el.value = value;
  }

  function applyAssumptions(a, state) {
    setIfAuto(els.shares, 'shares', a.shares);
    setIfAuto(els.btcHoldings, 'btcHoldings', a.btcHoldings);
    setIfAuto(els.debt, 'debt', Math.round(a.debt));
    setIfAuto(els.preferred, 'preferred', Math.round(a.preferred));
    dilutedShares = a.dilutedShares;
    assumpState = state;
    assumpMeta = { treasuryDate: a.treasuryDate, fetchedAt: a.fetchedAt };
    recalc();
    renderAssumpStatus();
  }

  function refreshAssumptions(force) {
    if (assumpInFlight) return;
    var cached = readCache();
    if (!force && cached) {
      var age = Date.now() - new Date(cached.fetchedAt).getTime();
      if (isFinite(age) && age < ASSUMPTIONS_MAX_AGE_MS) {
        applyAssumptions(cached, 'cache');
        return;
      }
    }
    assumpInFlight = true;
    fetchAssumptions()
      .then(function (a) {
        writeCache(a);
        applyAssumptions(a, 'live');
      })
      .catch(function () {
        // 取得できなければキャッシュ、それも無ければハードコード値のまま
        if (cached) applyAssumptions(cached, 'cache');
        else { assumpState = 'fallback'; renderAssumpStatus(); }
      })
      .finally(function () { assumpInFlight = false; });
  }

  function refreshStockPrice() {
    fetchStockPrice()
      .then(function (v) {
        setIfAuto(els.stockPrice, 'stockPrice', v);
        stockSource = new Date();
        stockError = false;
        recalc();
        renderStockStatus();
      })
      .catch(function () {
        stockError = true;
        renderStockStatus();
      });
  }
```

- [ ] **Step 6: Task 8 が中身を入れる関数を仮置きする**

`renderStatus` 関数の直後に挿入する:

```js
  function renderStockStatus() { /* Task 8 で実装 */ }
  function renderAssumpStatus() { /* Task 8 で実装 */ }
```

- [ ] **Step 7: 起動と定期実行に組み込む**

`startPolling` の中身を差し替える:

```js
  function startPolling() {
    stopPolling();
    timer = setInterval(function () {
      fetchNow();
      refreshStockPrice();
    }, REFRESH_MS);
  }
```

`visibilitychange` ハンドラの `else` 節を差し替える:

```js
    } else {
      fetchNow();
      refreshStockPrice();
      refreshAssumptions(false);
      startPolling();
    }
```

ファイル末尾の起動シーケンス(`recalc(); renderStatus('loading'); fetchNow(); startPolling();`)を
差し替える:

```js
  // まずキャッシュ(無ければハードコード値)で即座に描いてから取得に行く。
  // 808KB を待つ白画面は作らない。
  var boot = readCache();
  if (boot) applyAssumptions(boot, 'cache');

  recalc();
  renderStatus('loading');
  renderStockStatus();
  renderAssumpStatus();
  fetchNow();
  refreshStockPrice();
  refreshAssumptions(false);
  startPolling();
```

- [ ] **Step 8: ブラウザで手動確認する**

`index.html` を開き、DevTools のコンソールでエラーが出ないこと、および:

```js
JSON.parse(localStorage.getItem('mnav.assumptions.v1'))
```

が `shares: 1345340624` を含むオブジェクトを返すことを確認する。株価欄が
自動で埋まること、Network タブに `latest.json` / `3350_T.v*.json` / `prices-live.json` が
出ていることも見る。

- [ ] **Step 9: 回帰確認**

Run: `node --test tests/`
Expected: 19 tests PASS(純粋関数には触れていないので変化なし)

- [ ] **Step 10: コミット**

```bash
git add index.html
git commit -F - <<'MSG'
Wire up automatic fetching of assumptions and stock price

前提条件は latest.json で版数を得てから版数付き本体を取る2段構成。
本体は Cache-Control: immutable なので fetchJson にキャッシュモードを
足してブラウザの HTTP キャッシュを効かせる。

起動時はキャッシュで即描画してから取得に行く。808KB を待つ白画面は作らない。
取得失敗時はキャッシュ、それも無ければハードコード値のまま据え置く。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 7: 希薄化後の倍率を表示する

**Files:**
- Modify: `index.html`(CSS、`.mnav-duo` の直後のマークアップ、`els`、`recalc`)

**Interfaces:**
- Consumes: Task 6 のモジュール変数 `dilutedShares`
- Produces: DOM 要素 `evMnavDiluted` / `mnavDiluted` / `dilutedSharesOut`

- [ ] **Step 1: CSS を足す**

`.pill.flat { ... }` の行の直後に挿入する:

```css
  .diluted {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 14px;
    padding-top: 14px;
    border-top: 1px solid var(--border);
    font-size: 13px;
    color: var(--text-muted);
  }
  .diluted .lead { font-weight: 700; color: var(--structure); }
  .diluted .vals b { font-weight: 600; color: var(--text); }
  .diluted .note { font-size: 12px; opacity: 0.85; }
```

- [ ] **Step 2: マークアップを足す**

`.mnav-duo` を閉じる `</div>` の直後、`<div class="bars">` の前に挿入する:

```html
    <div class="diluted">
      <span class="lead">完全希薄化後</span>
      <span class="vals mono">EV mNAV <b id="evMnavDiluted">&mdash;</b>x ・ mNAV <b id="mnavDiluted">&mdash;</b>x</span>
      <span class="note"><span id="dilutedSharesOut">&mdash;</span>株(ワラント等が全て行使された場合)</span>
    </div>
```

- [ ] **Step 3: `els` に登録する**

`els` の `mnavOut: $('mnavOut'), evMnavOut: $('evMnavOut'),` の行の直後に追加:

```js
    evMnavDiluted: $('evMnavDiluted'), mnavDiluted: $('mnavDiluted'),
    dilutedSharesOut: $('dilutedSharesOut'),
```

- [ ] **Step 4: `recalc` で計算する**

`recalc` 内の `setPill(els.statePill, mnav);` の直前に挿入する:

```js
    // 希薄化後。発行済ベースとの差そのものが見たい情報なので、
    // トグルで切り替えるのではなく常に並べて出す。
    var dilMc = stockPrice * dilutedShares;
    var dilEv = dilMc + debt + preferred;
    els.mnavDiluted.textContent = fmtMultiple(btcNav > 0 ? dilMc / btcNav : NaN);
    els.evMnavDiluted.textContent = fmtMultiple(btcNav > 0 ? dilEv / btcNav : NaN);
    els.dilutedSharesOut.textContent = isFinite(dilutedShares)
      ? dilutedShares.toLocaleString('ja-JP') : '—';
```

入力が不正なときの早期 return の中、`els.evMnavOut.textContent = '—';` の直後にも追加する:

```js
      els.mnavDiluted.textContent = '—';
      els.evMnavDiluted.textContent = '—';
```

- [ ] **Step 5: ブラウザで確認する**

`index.html` を開き、希薄化後の行に発行済ベースより**大きい**倍率が2つ出ることを確認する。
株数が 1,631,382,824 と表示されること。株価 246 / BTC価格 12,079,068 のとき
EV mNAV 0.95・mNAV 0.77 前後になる。

- [ ] **Step 6: コミット**

```bash
git add index.html
git commit -F - <<'MSG'
Show fully diluted multiples

メタプラは行使価額修正条項付ワラントで株数が増え続けるため、希薄化後の
倍率には実質的な意味がある。トグルで切り替えると希薄化前後の差そのものが
見えなくなるので、常に並べて出す。棒グラフは発行済ベースのまま据え置き。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 8: 状態表示と手動上書きのフィールド単位化

**Files:**
- Modify: `index.html`(マークアップ、`els`、`autoMode` の置き換え、`renderStockStatus` / `renderAssumpStatus`、イベント配線)

**Interfaces:**
- Consumes: Task 6 の `assumpState` / `assumpMeta` / `stockSource` / `stockError` / `refreshAssumptions` / `refreshStockPrice`
- Produces: モジュール変数 `manual`(フィールド名 → boolean)。Task 6 の `setIfAuto` がこれを読む

現行の `autoMode` は BTC 価格専用のグローバルフラグ。これを `manual` に一本化する。
2つの仕組みを並存させない。

- [ ] **Step 1: `autoMode` を `manual` に置き換える**

`var autoMode = true;` を削除し、代わりに:

```js
  // フィールドごとの手動上書き。ひとつ手で編集しても他は自動のまま動く。
  var manual = {
    stockPrice: false, btcPrice: false,
    shares: false, btcHoldings: false, debt: false, preferred: false
  };
```

`autoMode` を参照している5箇所を読み替える:

- `renderStatus` の `if (!autoMode) {` → `if (manual.btcPrice) {`
- 同じブロック内の `autoMode = true;` → `manual.btcPrice = false;`
- `fetchNow` の `if (inFlight || !autoMode) return;` → `if (inFlight || manual.btcPrice) return;`
- `fetchNow` 内の `if (autoMode) {` → `if (!manual.btcPrice) {`
- `els.btcPrice` の input ハンドラの `if (autoMode) { autoMode = false;` → `if (!manual.btcPrice) { manual.btcPrice = true;`

- [ ] **Step 2: 状態表示のマークアップを足す**

株価の `<div class="input-wrap">` を閉じる `</div>` の直後(BTC価格の `<div class="field">` の前)に挿入:

```html
      <div class="price-status" id="stockStatus">
        <span class="dot loading" id="stockDot"></span>
        <span id="stockText">株価を取得しています…</span>
      </div>
```

`<p class="asof">` の直前に挿入:

```html
      <div class="price-status" id="assumpStatus">
        <span class="dot loading" id="assumpDot"></span>
        <span id="assumpText">前提条件を取得しています…</span>
      </div>
```

`<p class="asof">` の段落を丸ごと次に差し替える:

```html
      <p class="asof">
        前提条件は <a href="https://analytics.metaplanet.jp/" target="_blank" rel="noopener">analytics.metaplanet.jp</a> と同じデータ源(strategytracker)から自動取得しています。1日1回、または上の「更新」を押したときに取りに行きます。買い増しの開示があった日は「更新」で即座に反映されます。<br>
        いずれかの欄を手で編集するとその欄だけ自動取得が止まり、「自動に戻す」で復帰します。他の欄は自動のまま動き続けるので、「もし株価が250円だったら」のような試算ができます。
      </p>
```

`<button class="reset-btn" id="resetBtn" type="button">既定値にリセット</button>` を差し替える:

```html
      <button class="reset-btn" id="resetBtn" type="button">すべて自動取得値に戻す</button>
```

- [ ] **Step 3: `els` に登録する**

`els` の `priceStatus: $('priceStatus'), statusDot: $('statusDot'), statusText: $('statusText')` の行を差し替える:

```js
    priceStatus: $('priceStatus'), statusDot: $('statusDot'), statusText: $('statusText'),
    stockStatus: $('stockStatus'), stockDot: $('stockDot'), stockText: $('stockText'),
    assumpStatus: $('assumpStatus'), assumpDot: $('assumpDot'), assumpText: $('assumpText')
```

- [ ] **Step 4: 状態表示を実装する**

Task 6 で置いた空の `renderStockStatus` / `renderAssumpStatus` を差し替える:

```js
  function renderStockStatus() {
    var old = document.getElementById('stockResumeBtn');
    if (old) old.remove();

    if (manual.stockPrice) {
      els.stockDot.className = 'dot manual';
      els.stockText.textContent = '株価 手動入力中 ・ 自動取得は停止中';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'stockResumeBtn';
      btn.className = 'linkish';
      btn.textContent = '自動に戻す';
      btn.addEventListener('click', function () {
        manual.stockPrice = false;
        renderStockStatus();
        refreshStockPrice();
      });
      els.stockStatus.appendChild(btn);
      return;
    }
    if (stockError) {
      els.stockDot.className = 'dot error';
      els.stockText.textContent = '株価の取得に失敗 ・ 1分後に再試行';
      return;
    }
    if (!stockSource) {
      els.stockDot.className = 'dot loading';
      els.stockText.textContent = '株価を取得しています…';
      return;
    }
    els.stockDot.className = 'dot live';
    els.stockText.textContent = '株価 ・ strategytracker ・ ' + fmtTime(stockSource) + ' 取得';
  }

  function renderAssumpStatus() {
    var old = document.getElementById('assumpRefreshBtn');
    if (old) old.remove();

    if (assumpState === 'fallback') {
      // 黙って古い数字を出すのが元々の問題だったので、ここは目立たせる
      els.assumpDot.className = 'dot error';
      els.assumpText.textContent = '自動取得できず ・ ' + DEFAULTS.treasuryDate + '時点の固定値';
    } else {
      var d = assumpMeta ? assumpMeta.treasuryDate : DEFAULTS.treasuryDate;
      var at = assumpMeta ? new Date(assumpMeta.fetchedAt) : null;
      var when = (at && isFinite(at.getTime())) ? fmtTime(at) : '不明';
      if (assumpState === 'cache') {
        els.assumpDot.className = 'dot manual';
        els.assumpText.textContent = '前提条件 ・ ' + d + '開示 ・ キャッシュ(' + when + ' 取得)';
      } else {
        els.assumpDot.className = 'dot live';
        els.assumpText.textContent = '前提条件 ・ ' + d + '開示 ・ ' + when + ' 取得';
      }
    }

    var refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.id = 'assumpRefreshBtn';
    refresh.className = 'linkish';
    refresh.textContent = '更新';
    refresh.addEventListener('click', function () { refreshAssumptions(true); });
    els.assumpStatus.appendChild(refresh);
  }
```

- [ ] **Step 5: 手動検知を全フィールドに広げる**

現行の以下のブロックを削除する:

```js
  [els.stockPrice, els.shares, els.btcHoldings, els.debt, els.preferred].forEach(function (el) {
    el.addEventListener('input', recalc);
  });
```

代わりに挿入する:

```js
  // プログラムからの .value 代入では input は発火しないので、
  // ここに来るのは人間が編集したときだけ。
  [['stockPrice', renderStockStatus], ['shares', renderAssumpStatus],
   ['btcHoldings', renderAssumpStatus], ['debt', renderAssumpStatus],
   ['preferred', renderAssumpStatus]].forEach(function (pair) {
    var key = pair[0], render = pair[1];
    els[key].addEventListener('input', function () {
      if (!manual[key]) { manual[key] = true; render(); }
      recalc();
    });
  });
```

- [ ] **Step 6: リセットボタンを作り直す**

`els.resetBtn` のハンドラを丸ごと差し替える。ハードコード値に戻す動作は
自動取得がある以上むしろ有害なので廃止する。

```js
  // 「既定値に戻す」ではなく「自動取得値に戻す」。ハードコード値は
  // あくまで取得できないときの最後の砦であって、戻る先ではない。
  els.resetBtn.addEventListener('click', function () {
    manual.stockPrice = false; manual.btcPrice = false;
    manual.shares = false; manual.btcHoldings = false;
    manual.debt = false; manual.preferred = false;
    renderStatus('loading');
    renderStockStatus();
    fetchNow();
    refreshStockPrice();
    refreshAssumptions(true);
  });
```

- [ ] **Step 7: ブラウザで確認する**

`index.html` を開き、以下を順に確認する。

1. 状態表示が3行出て、それぞれ緑のドットになる
2. 株価欄を手で書き換える → その行だけ「手動入力中」に変わり、**前提条件の行は緑のまま**
3. 「自動に戻す」を押す → 株価が自動値に戻る
4. 前提条件の「更新」を押す → Network タブに `latest.json` と `3350_T.v*.json` が再度出る
5. DevTools の Network を Offline にしてリロード → 前提条件の行が「キャッシュ」表示になる
6. Offline のまま `localStorage.clear()` してリロード → 赤いドットで「自動取得できず ・ 固定値」

- [ ] **Step 8: 回帰確認**

Run: `node --test tests/`
Expected: 19 tests PASS

- [ ] **Step 9: コミット**

```bash
git add index.html
git commit -F - <<'MSG'
Show data provenance per row, make overrides per-field

autoMode(BTC価格専用のグローバルフラグ)を manual{} に一本化し、
欄ごとに手動上書きできるようにした。ひとつ手で編集しても他は自動のまま
動くので、「もし株価が250円だったら」の試算ができる。

状態表示を3行に分け、キャッシュ利用中とハードコード値まで後退した場合を
区別して出す。黙って古い数字を出すのが元々の問題だったので、
後退時は赤で強調する。

「既定値にリセット」は「すべて自動取得値に戻す」に置き換えた。
ハードコード値は最後の砦であって戻る先ではない。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 9: 既定値と文書の更新

**Files:**
- Modify: `index.html`(`DEFAULTS`、input の `value`、footnote)
- Modify: `README.md`

**Interfaces:**
- Consumes: なし
- Produces: `DEFAULTS.dilutedShares`、`DEFAULTS.treasuryDate`(Task 6・8 が参照済み)

- [ ] **Step 1: `DEFAULTS` の値を更新する**

キー `dilutedShares` / `treasuryDate` は Task 6 で追加済み。ここでは値を実測値に揃える。

```js
  // 自動取得もキャッシュも使えないときの最後の砦。2026-09-09 時点の実測値。
  // 通常はここに落ちてこない。落ちたときは画面に赤く出る。
  var DEFAULTS = {
    stockPrice: 246.00,
    btcPrice: 12079068,
    shares: 1345340624,
    dilutedShares: 1631382824,
    btcHoldings: 43000,
    debt: 71200000000,
    preferred: 23610000000,
    treasuryDate: '2026-08-31'
  };
```

- [ ] **Step 2: input の `value` を `DEFAULTS` に合わせる**

`id="shares"` の `value="1345352000"` → `value="1345340624"`
`id="debt"` の `value="71300000000"` → `value="71200000000"`
`id="preferred"` の `value="23600000000"` → `value="23610000000"`

- [ ] **Step 3: footnote を直す**

footnote の「株価は自動取得に対応した無償APIがないため手動入力です。」は事実でなくなった。
その一文を次に差し替える:

```
株価と前提条件(株数・BTC保有量・負債・優先株)は analytics.metaplanet.jp と同じデータ源から自動取得しています。
```

- [ ] **Step 4: README の「価格の自動取得」表を更新する**

現行の2行の表を次に差し替える:

```markdown
| 系統 | 提供元 | 取得内容 | 頻度 |
|---|---|---|---|
| BTC価格・主系 | [CoinGecko](https://www.coingecko.com/) | BTC/JPY を直接取得 | 60秒 |
| BTC価格・予備 | [Kraken](https://www.kraken.com/) + [ExchangeRate-API](https://www.exchangerate-api.com/) | BTC/USD × USD/JPY | 60秒 |
| 株価 | strategytracker | 3350.T の円建て価格 | 60秒 |
| 前提条件 | strategytracker | 株数・BTC保有量・負債・優先株 | 1日1回 + 手動 |
```

「株価(3350)は、無償かつCORS対応のAPIが見当たらないため手動入力です。」の一文を削除する。

- [ ] **Step 5: README の「前提条件の更新」の節を書き直す**

手で更新する前提の説明はもう当てはまらない。節を丸ごと差し替える:

```markdown
## 前提条件

株数・BTC保有量・有利子負債・優先株残高は自動取得します。1日1回、
または画面の「更新」を押したときに取りに行きます。買い増しの開示があった日は
「更新」を押せば即座に反映されます。

画面の「前提条件を編集」から手で上書きもできます。上書きした欄だけ自動取得が
止まり、他の欄は自動のまま動きます。「すべて自動取得値に戻す」で復帰します。

取得できないときはキャッシュ、それも無ければファイル内の固定値
(2026-08-31開示時点)まで後退し、その旨を画面に赤く表示します。
黙って古い数字を出すことはありません。
```

- [ ] **Step 6: README の「残差 0.01 について」を書き直す**

現行の節は**内容が誤っている**。本家の EV に出所不明の約9億円が含まれると書いたが、
実際は表示タイミングの差だった。節を丸ごと差し替える:

```markdown
### 本家と 0.01 ずれることがある

本家の EV mNAV タイルは1日数回更新されるスナップショットの株価を使い、
株価・時価総額タイルはライブの株価を出しています。この2つが1円ずれると
時価総額で13.5億円動くため、切り捨て表示の境目をまたいで 0.01 の差が出ます。

貸借対照表に未知の項目があるわけではありません。同じ株価で計算すれば
このツールと本家の EV mNAV は一致します。
```

- [ ] **Step 7: 全体を確認する**

Run: `node --test tests/`
Expected: 19 tests PASS

ブラウザで `index.html` を開き、本家 analytics.metaplanet.jp と並べて
EV mNAV が一致(または株価の更新タイミング差で 0.01 以内)することを確認する。

- [ ] **Step 8: コミット**

```bash
git add index.html README.md
git commit -F - <<'MSG'
Update fallback defaults and correct the README

DEFAULTS を 2026-09-09 時点の実測値に更新し、希薄化後株式数と
開示基準日を追加した。これは自動取得もキャッシュも使えないときの
最後の砦であって、通常は使われない。

README の「残差 0.01 について」は内容が誤っていたので書き直した。
本家の EV に出所不明の9億が含まれるのではなく、EV mNAV タイルが
スナップショット株価を、株価タイルがライブ株価を使っている
表示タイミングの差だった。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## 完了条件

- `node --test tests/` が 19 件すべて通る
- ブラウザで開いたとき、株価と前提条件が手入力なしで埋まる
- 本家 analytics.metaplanet.jp の EV mNAV と 0.01 以内で一致する
- オフラインでリロードしてもキャッシュで動き、状態が画面に出る
- `localStorage` を空にしてオフラインで開くと、赤く「自動取得できず」と出る
- `index.html` をローカルでダブルクリックしても動く
- `package.json` が存在せず、`index.html` は1枚のまま
