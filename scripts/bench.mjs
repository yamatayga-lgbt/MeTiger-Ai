#!/usr/bin/env node
/**
 * MeTiger Bench — прогон набора bench/questions.mjs на живом проде.
 *
 *   node scripts/bench.mjs                 MeTiger и DeepSeek, отчёт в docs/bench/
 *   node scripts/bench.mjs --only metiger  только один участник
 *   node scripts/bench.mjs --cat код       только одна категория
 *   node scripts/bench.mjs --par 3         параллельность (по умолчанию 2)
 *
 * Участники:
 *   metiger  — обычный путь сайта: агент сам выбирает модели, навыки, инструменты, совет.
 *   deepseek — тот же сайт, но модель закреплена (odirouter · deepseek-v4-flash) и свой
 *              простой system: навыки и советы не подключаются. Это приближение к
 *              «голому» чату DeepSeek — своего ключа DeepSeek у проекта нет.
 *
 * Код из ответа запускается в отдельном процессе node с таймаутом 3 с.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { QUESTIONS } from '../bench/questions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.BENCH_API || 'https://metiger-ai.pages.dev/api/chat';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PAR = Number(arg('par', 2));
const ONLY = arg('only', '');
const CAT = arg('cat', '');

const RUNNERS = {
  metiger: (q) => ({ text: q }),
  deepseek: (q) => ({ text: q, provider: 'odirouter', model: 'deepseek-v4-flash', system: 'Ты полезный ассистент. Отвечай на языке вопроса.' }),
};

/* Сайт пускает 12 запросов в минуту с одного адреса (RATE_MAX) — держим 10 и общий
   для всех потоков интервал, а «слишком часто» пережидаем, а не засчитываем провалом. */
const GAP = Number(arg('gap', 6200));
let nextSlot = 0;
async function slot() { const now = Date.now(); const at = Math.max(now, nextSlot); nextSlot = at + GAP; if (at > now) await new Promise((r) => setTimeout(r, at - now)); }

async function ask(who, q) {
  await slot();
  const t0 = Date.now();
  const body = Object.assign({ chatId: 'bench-' + who + '-' + Math.random().toString(36).slice(2) }, RUNNERS[who](q));
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 MeTigerBench' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
      const d = await r.json();
      if (d && d.ok) return { ok: true, reply: String(d.reply || ''), ms: Date.now() - t0, model: d.model, provider: d.provider, pinMiss: !!d.pinMiss };
      if (/слишком часто/i.test(String(d && d.error)) && attempt < 3) { process.stderr.write('  … лимит сайта, жду 60 с\n'); await new Promise((res) => setTimeout(res, 60000)); await slot(); continue; }
      if (/ни один провайдер/i.test(String(d && d.error)) && attempt < 3) { process.stderr.write('  … провайдер молчит, жду 30 с\n'); await new Promise((res) => setTimeout(res, 30000)); await slot(); continue; }
      if (attempt >= 1) return { ok: false, reply: String(d.error || 'нет ответа'), ms: Date.now() - t0 };
    } catch (e) {
      if (attempt >= 1) return { ok: false, reply: String(e.message || e), ms: Date.now() - t0 };
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
}

function extractCode(reply) {
  const m = String(reply).match(/```(?:js|javascript|ts|typescript)?\s*\n([\s\S]*?)```/i);
  return m ? m[1] : (/function\s+\w+|=>/.test(reply) ? reply : '');
}

function runCode(reply, spec) {
  const code = extractCode(reply);
  if (!code) return { pass: false, why: 'нет блока кода' };
  const file = join(tmpdir(), 'bench-' + Math.random().toString(36).slice(2) + '.mjs');
  const harness = code.replace(/^\s*export\s+(default\s+)?/gm, '') + `
;const __f = typeof ${spec.fn} !== 'undefined' ? ${spec.fn} : null;
const __t = ${JSON.stringify(spec.tests)};
const __eq = (a, b) => JSON.stringify(a) === JSON.stringify(b) || (a && b && typeof a === 'object' && JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort()));
let __ok = 0; const __bad = [];
for (const [args, exp] of __t) { try { const got = __f(...args); if (__eq(got, exp)) __ok++; else __bad.push(JSON.stringify(args) + ' → ' + JSON.stringify(got)); } catch (e) { __bad.push(JSON.stringify(args) + ' ✗ ' + e.message); } }
console.log(JSON.stringify({ ok: __ok, n: __t.length, bad: __bad.slice(0, 2) }));`;
  writeFileSync(file, harness);
  try {
    const out = execFileSync(process.execPath, [file], { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const r = JSON.parse(out.trim().split('\n').pop());
    return { pass: r.ok === r.n, why: r.ok === r.n ? '' : `тестов ${r.ok}/${r.n}: ${r.bad.join('; ')}` };
  } catch (e) {
    return { pass: false, why: 'код не запустился: ' + String((e.stderr || e.message || '')).split('\n').find((l) => /Error/.test(l)) };
  }
}

function grade(item, res) {
  if (!res.ok) return { pass: false, why: 'ошибка: ' + res.reply.slice(0, 80) };
  if (item.code) return runCode(res.reply, item.code);
  let pass = false;
  try { pass = !!item.check(res.reply); } catch { pass = false; }
  return { pass, why: pass ? '' : 'ответ: ' + res.reply.replace(/\s+/g, ' ').slice(0, 110) };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

/* --redo файл.json — переспросить только те вопросы, где был сбой доступа (не ответ),
   остальное взять из прошлого прогона. Сбой доступа — не ошибка модели. */
const REDO = arg('redo', '');
const prev = REDO ? JSON.parse(readFileSync(REDO, 'utf8')).results : null;
const who = prev ? Object.keys(prev) : (ONLY ? [ONLY] : Object.keys(RUNNERS));
const qs = QUESTIONS.filter((x) => (!CAT || x.cat === CAT) && (!prev || Object.values(prev).some((arr) => arr.some((y) => y.id === x.id))));
const results = {};
for (const w of who) {
  process.stderr.write(`── ${w}: ${qs.length} вопросов\n`);
  results[w] = await pool(qs, PAR, async (item) => {
    const old = prev && prev[w] && prev[w].find((x) => x.id === item.id);
    if (old && /^ошибка/.test(old.why || '') && process.argv.includes('--offline')) return old;
    if (old && !/^ошибка/.test(old.why || '')) { const g0 = grade(item, { ok: true, reply: old.reply || '' }); return Object.assign({}, old, { pass: g0.pass, why: g0.why }); }
    const res = await ask(w, item.q);
    const g = grade(item, res);
    process.stderr.write(`${g.pass ? '✔' : '✖'} ${w} ${item.id} ${(res.ms / 1000).toFixed(1)}с ${g.why.slice(0, 90)}\n`);
    return { id: item.id, cat: item.cat, pass: g.pass, why: g.why, ms: res.ms, model: res.model, provider: res.provider, reply: res.reply };
  });
}

/* ───────── отчёт ───────── */
const cats = [...new Set(qs.map((x) => x.cat))];
const ver = (readFileSync(join(ROOT, 'src/lib/version.ts'), 'utf8').match(/APP_VERSION = '([^']+)'/) || [])[1] || '?';
const date = new Date().toISOString().slice(0, 10);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const lines = [];
lines.push(`# MeTiger Bench — ${date} · версия ${ver}`, '');
lines.push(`Вопросов: ${qs.length}. Проверка автоматическая: числа и факты сверяются с эталоном, код запускается и прогоняется тестами. Набор: \`bench/questions.mjs\`, прогон: \`node scripts/bench.mjs\`.`, '');
lines.push('| Категория | ' + who.join(' | ') + ' |', '|---|' + who.map(() => '---|').join(''));
for (const c of cats) {
  lines.push(`| ${c} | ` + who.map((w) => { const r = results[w].filter((x) => x.cat === c); const p = r.filter((x) => x.pass).length; return `${p}/${r.length} (${pct(p, r.length)}%)`; }).join(' | ') + ' |');
}
lines.push('| **Итого** | ' + who.map((w) => { const r = results[w]; const p = r.filter((x) => x.pass).length; return `**${p}/${r.length} (${pct(p, r.length)}%)**`; }).join(' | ') + ' |');
lines.push('| Сбой доступа (не ответил вовсе) | ' + who.map((w) => results[w].filter((x) => /^ошибка/.test(x.why || '')).length).join(' | ') + ' |');
lines.push('| Медиана времени | ' + who.map((w) => (med(results[w].map((x) => x.ms)) / 1000).toFixed(1) + ' с').join(' | ') + ' |', '');
for (const w of who) {
  const bad = results[w].filter((x) => !x.pass);
  lines.push(`## Ошибки ${w} (${bad.length})`, '');
  for (const b of bad) lines.push(`- **${b.id}** (${b.cat}, ${b.provider || '—'}/${b.model || '—'}): ${b.why.replace(/\|/g, '\\|')}`);
  lines.push('');
}
if (who.length === 2) {
  const [a, b] = who;
  const onlyA = qs.filter((x, i) => results[a][i].pass && !results[b][i].pass).map((x) => x.id);
  const onlyB = qs.filter((x, i) => !results[a][i].pass && results[b][i].pass).map((x) => x.id);
  lines.push('## Где разошлись', '', `- верно только у ${a}: ${onlyA.join(', ') || '—'}`, `- верно только у ${b}: ${onlyB.join(', ') || '—'}`, '');
}
mkdirSync(join(ROOT, 'docs/bench'), { recursive: true });
const base = join(ROOT, 'docs/bench', `bench-${date}-v${ver}`);
writeFileSync(base + '.md', lines.join('\n'));
writeFileSync(base + '.json', JSON.stringify({ date, version: ver, results }, null, 1));
console.log(lines.join('\n'));
