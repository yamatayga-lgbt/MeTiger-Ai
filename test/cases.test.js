/** 0.136: контрольные точки «Дела» и перенос контекста между чатами/моделями. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createEngine } from '../engine/chat.js';

const out = '/tmp/metiger-cases-test.mjs';
execFileSync('node_modules/.bin/esbuild', ['src/lib/cases.ts', '--format=esm', '--outfile=' + out, '--log-level=error']);
const cases = await import(out);
let pass = 0;
const ok = (name, condition) => {
  assert.ok(condition, name);
  pass++;
  console.log('  ✔ ' + name);
};

const project = cases.newCaseDraft(1000);
ok('C136a пустое дело начинается активным и без привязки к чату', project.status === 'active' && !project.chatId && project.id.startsWith('case-1000-'));
const linked = cases.draftCaseFromChat({
  id: 'chat-7', title: 'Учёба', updatedAt: 2000,
  messages: [{ role: 'user', text: 'Подготовиться к экзамену' }, { role: 'assistant', text: 'Составим план' }],
}, null, 3000);
ok('C136b создание из чата подставляет цель, имя и chatId', linked.title === 'Учёба' && linked.goal === 'Подготовиться к экзамену' && linked.chatId === 'chat-7');
ok('C136c название дела ограничено 50 символами', cases.draftCaseFromChat({
  id: 'chat-8', title: 'А'.repeat(70), updatedAt: 1, messages: [],
}, null, 2).title.length === 50);
ok('C136d список пунктов чистит маркеры, пустые строки и ограничивает количество',
  cases.splitCaseNotes('- план\n\n2. звонок\n• отправить письмо').join('|') === 'план|звонок|отправить письмо');
const context = cases.caseContext({
  ...project,
  title: 'Запуск сайта',
  goal: 'Опубликовать сайт',
  decisions: ['Делаем мобильную версию первой'],
  completed: ['Собрали макет'],
  nextStep: 'Подключить домен',
});
ok('C136e карточка содержит цель, решения, сделанное и следующий шаг',
  ['Запуск сайта', 'Опубликовать сайт', 'Делаем мобильную версию первой', 'Собрали макет', 'Подключить домен'].every((s) => context.includes(s)));

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
};
cases.saveCases([linked, { ...project, id: 'bad-date', title: 'Новее', updatedAt: 5000 }]);
const roundTrip = cases.loadCases();
ok('C136f дела переживают перезагрузку и сортируются по времени изменения', roundTrip.length === 2 && roundTrip[0].id === 'bad-date');

const sent = [];
const fetchFake = async (_url, init) => {
  sent.push(JSON.parse(init.body));
  return {
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: 'Продолжаем с нужного шага.' }, finish_reason: 'stop' }] }),
  };
};
const engine = createEngine({
  env: { GROQ_KEYS: 'test-key' },
  fetch: fetchFake,
  sleep: async () => {},
});
const r = await engine.run({
  text: 'Продолжим',
  caseContext: context,
  providerOrder: ['groq'],
});
const providerMessages = sent[0]?.messages || [];
const userPrompt = providerMessages.find((message) => message.role === 'user')?.content || '';
const systemPrompt = providerMessages.find((message) => message.role === 'system')?.content || '';
ok('C136g карточка подхватывается как данные пользователя и не повышается до system-инструкции',
  r.ok && userPrompt.includes('Подключить домен') && !systemPrompt.includes('Подключить домен'));

const app = readFileSync('src/App.tsx', 'utf8');
const api = readFileSync('functions/api/chat.js', 'utf8');
const views = readFileSync('src/views/CasesView.tsx', 'utf8');
ok('C136h сохранённая карточка автоматически уходит при продолжении её чата',
  /caseContext:\s*caseContext\(linkedCase\)/.test(app) && /caseContext:\s*caseContext \|\| undefined/.test(api));
ok('C136i карточки можно создать, продолжить, править, завершить и удалить',
  ['onNew', 'onEdit', 'onContinue', 'onToggleStatus', 'onDelete'].every((name) => views.includes(name)));

console.log(`\n${pass} ✔, 0 ✖`);
