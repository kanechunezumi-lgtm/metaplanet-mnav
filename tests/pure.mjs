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
