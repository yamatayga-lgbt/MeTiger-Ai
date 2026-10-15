/**
 * 0.186 — Персонализация в стиле ChatGPT: базовый стиль и тон, дружелюбие,
 * энтузиазм, заголовки и списки, эмодзи, быстрые ответы, визуальные ответы.
 *
 * Владелец прислал скриншоты ChatGPT (15 окт 2026): строки со значениями и
 * всплывающие меню НАД соседними карточками. Раздел «Пользовательские
 * инструкции» на эскизе вычеркнут — его в экране быть не должно.
 *
 * Здесь держим всю цепочку: модель настроек в браузере → поле persona в
 * /api/chat → блок в системной подсказке движка. На живом прогоне двигателя.
 *
 *   node test/persona.test.js
 */
import { buildTable } from '../engine/providers.js';
import { createEngine } from '../engine/chat.js';
import * as personaStyle from '../engine/personastyle.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 200) : '')); }
};

const view = readFileSync('src/views/PersonalizationView.tsx', 'utf8');
const lib = readFileSync('src/lib/persona.ts', 'utf8');
const api = readFileSync('src/lib/api.ts', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');
const css = readFileSync('src/styles/index.css', 'utf8');
const door = readFileSync('functions/api/chat.js', 'utf8');

console.log('P — серверный слой: настройки → блок подсказки');
ok('P1: всё по умолчанию — пустая строка, промпт не разрастается',
  personaStyle.block({}) === '' && personaStyle.block({ style: 'default', emoji: 'default', quick: false }) === '');
ok('P2: каждый стиль говорит своими словами — циничный не «вежливый»',
  /цинн|саркаст/.test(personaStyle.block({ style: 'cynical' }))
    && /тёплый|разговорчив/.test(personaStyle.block({ style: 'friendly' }))
    && /немногословн/.test(personaStyle.block({ style: 'efficient' })));
ok('P3: уровни «менее/более» — про то же, что в интерфейсе',
  /дружелюбн/.test(personaStyle.block({ friendliness: 'more' }))
    && /Эмодзи — не используй/.test(personaStyle.block({ emoji: 'less' }))
    && /связный текст/.test(personaStyle.block({ headers: 'less' })));
ok('P4: мусор в поле запроса — умолчания, а не текст в подсказке',
  personaStyle.normalize({ style: 'ХАК', emoji: 'мусор', quick: 'да' }).style === 'default'
    && personaStyle.normalize({ style: 'ХАК', emoji: 'мусор', quick: 'да' }).emoji === 'default'
    && personaStyle.normalize({ style: 'ХАК', emoji: 'мусор', quick: 'да' }).quick === false);
ok('P5: блок честно называет себя настройкой человека, а не правкой движка',
  personaStyle.block({ style: 'cynical' }).indexOf('настройка человека') > 0);

console.log('E — живой прогон двигателя');
{
  let systemSeen = '';
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    systemSeen = (body.messages || []).find((m) => m.role === 'system')?.content || body.system || '';
    return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'Ответ.' }, finish_reason: 'stop' }] }) };
  };
  const e = createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: impl, sleep: async () => {} });
  await e.run({ text: 'привет', persona: { style: 'cynical', emoji: 'more', quick: true } });
  ok('E1: выбранное — в system: стиль, эмодзи и быстрые ответы',
    systemSeen.includes('[Стиль общения') && systemSeen.includes('цин') && systemSeen.includes('Эмодзи') && systemSeen.includes('Быстрые ответы'));
  await e.run({ text: 'привет', persona: { style: 'default', emoji: 'default' } });
  ok('E2: всё по умолчанию — system прежний, блока нет',
    !systemSeen.includes('[Стиль общения'));
  await e.run({ text: 'привет', persona: { style: '</script>', emoji: 'мусор' } });
  ok('E3: мусор из тела запроса не доезжает до подсказки',
    !systemSeen.includes('</script>') && !systemSeen.includes('[Стиль общения'));
}

console.log('F — фронт: экран, хранение и поле запроса');
ok('F1: экран знает все семь настроек, как в ChatGPT',
  view.includes('Базовый стиль и тон') && view.includes('Дружелюбие') && view.includes('Энтузиазм')
    && view.includes('Заголовки и списки') && view.includes('Эмодзи')
    && view.includes('Быстрые ответы') && view.includes('Визуальные ответы'));
ok('F2: «Пользовательские инструкции» вычеркнуты владельцем — их нет',
  !view.includes('Пользовательские инструкции'));
ok('F3: меню всплывает НАД карточками: затемнение и меню выше прочих окон',
  /\.persona-backdrop \{[\s\S]{0,120}z-index: 60/.test(css) && /\.persona-pop \{[\s\S]{0,240}z-index: 61/.test(css));
ok('F4: пункты меню — название + пояснение, у выбранного галочка',
  /\.persona-pop-title \{/.test(css) && /\.persona-pop-sub \{/.test(css) && view.includes('persona-pop-check'));
ok('F5: настройки хранятся в mt-persona и едут в запрос только не-умолчания',
  lib.includes("PERSONA_KEY = 'mt-persona'") && /personaForRequest[\s\S]{0,200}isDefaultPersona/.test(lib)
    && api.includes('persona: opts.persona || undefined'));
ok('F6: отправка читает те же настройки (App.tsx), что и экран',
  app.includes('personaForRequest(readPersona())') && view.includes("'mt-persona'"));
ok('F7: дверь валидирует persona по белому списку до движка',
  door.includes('persona: personaStyle.normalize(body.persona)'));

console.log(`\n${pass} ✔, ${fail} ✖`);
if (fail) process.exit(1);
console.log('✔ 0.186: Персонализация как в ChatGPT — проверки пройдены');
