#!/usr/bin/env node
/**
 * Дымовой тест живого сайта (план обгона, волна 1, пункт 5).
 *
 * Сторож watch-prod проверяет «на проде наша сборка». Этот скрипт проверяет другое:
 * «на проде агент работает» — тремя настоящими ходами: текст, картинка, файл.
 * Проверять нужно именно живьём: ключи, квоты провайдеров и поиск живут в
 * окружении Cloudflare, а не в репозитории, и падение там не видно ни тестам, ни
 * сборке. Молчаливо сломанный прод — худший из сбоев: всё зелёное, а людям не
 * отвечают.
 *
 *   node scripts/smoke-prod.mjs            # три хода, ~1-3 минуты
 *   node scripts/smoke-prod.mjs --url=http://localhost:4173   # куда угодно
 *
 * Выход 1 — если хотя бы один ход не ответил или ответ пуст: CI покажет красное.
 */
const args = process.argv.slice(2);
const URL_BASE = ((args.find((a) => a.startsWith('--url=')) || '').slice(6) || 'https://metiger-ai.pages.dev').replace(/\/$/, '');
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
/* Браузерные заголовки обязательны: Cloudflare отвечает 403 на запросы «из ниоткуда». */
const HEADERS = {
  'content-type': 'application/json',
  origin: URL_BASE,
  referer: URL_BASE + '/',
  'user-agent': UA,
};

const STEPS = [
  {
    id: 'text',
    title: 'Текст',
    body: { text: 'Ответь одним коротким предложением: что ты умеешь?' },
  },
  {
    id: 'image',
    title: 'Картинка',
    body: { text: 'Нарисуй картинку: синий круг на белом фоне' },
  },
  {
    id: 'file',
    title: 'Файл',
    body: { text: 'Сделай текстовый файл shopping.txt со списком покупок из трёх пунктов' },
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(step) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 240000);
  try {
    const r = await fetch(URL_BASE + '/api/chat', {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(step.body),
      signal: ctrl.signal,
    });
    const ms = Date.now() - t0;
    if (!r.ok) return { ok: false, why: 'сервер ответил ' + r.status, ms };
    const j = await r.json().catch(() => null);
    if (!j) return { ok: false, why: 'ответ не разобрался как JSON', ms };
    return { ok: true, j, ms };
  } catch (e) {
    return { ok: false, why: String((e && e.message) || e), ms: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}

console.log('дымовой тест прода: ' + URL_BASE);
let bad = 0;
for (const step of STEPS) {
  const r = await ask(step);
  if (!r.ok) {
    console.log(`  ✖ ${step.title}: ${r.why} (${Math.round(r.ms / 1000)} с)`);
    bad++;
    continue;
  }
  const j = r.j;
  const reply = String(j.reply || '').trim();
  const files = Array.isArray(j.files) ? j.files : [];
  if (!j.ok) {
    console.log(`  ✖ ${step.title}: движок ответил ошибкой — ${String(j.error || 'без слова').slice(0, 120)}`);
    bad++;
    continue;
  }
  if (!reply) {
    console.log(`  ✖ ${step.title}: пустой ответ (${Math.round(r.ms / 1000)} с, ${j.provider || '?'})`);
    bad++;
    continue;
  }
  /* Картинка и файл — проверяем не слова, а вложение: именно оно делает нас сильнее
     DeepSeek, и именно оно ломается тише всего. */
  if (step.id === 'image' && !files.some((f) => String(f.mime || '').startsWith('image/'))) {
    console.log(`  ✖ Картинка: ответ есть, а картинки нет (файлов ${files.length}) — ${reply.slice(0, 80)}`);
    bad++;
    continue;
  }
  if (step.id === 'file' && !files.length) {
    console.log(`  ✖ Файл: ответ есть, а файла нет — ${reply.slice(0, 80)}`);
    bad++;
    continue;
  }
  const what = files.length ? ` · файлов ${files.length}: ${files.map((f) => f.name).join(', ')}` : '';
  console.log(`  ✔ ${step.title}: ${Math.round(r.ms / 1000)} с${j.provider ? ' · ' + j.provider : ''} · ${reply.length} зн.${what}`);
  if (step.id !== 'text') await sleep(1500);
}

console.log(bad ? `\nдымовой тест не прошёл: ${bad} из ${STEPS.length}` : `\nвсе три хода прошли: текст, картинка, файл`);
process.exit(bad ? 1 : 0);
