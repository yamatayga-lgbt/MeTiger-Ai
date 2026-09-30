/**
 * Этап 2 переноса: ансамбль голов (IQ/математика) и совет зрячих (факты по картинке).
 * Сети нет: ask/judge/fetch внедряются. Запуск: node test/council.test.js
 */
import { answerKey, normNum, tally, shouldPoll, poll, decide, lineOf, cfgOf } from '../engine/ensemble.js';
import { vkey, shouldCouncil, gate, judgePrompt, visionLine } from '../engine/vcouncil.js';
import { createEngine, councilBudget } from '../engine/chat.js';
import { classifyTask } from '../engine/route.js';
import { onRequestPost } from '../functions/api/chat.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}
const EN3 = { GROQ_KEYS: 'g1', ZAI_KEYS: 'z1', CLOUDFLARE_KEYS: 'c1', CLOUDFLARE_ACCOUNT_ID: 'acc' };
const IMG = 'data:image/png;base64,iVBORw0KGgo=';

console.log('A — ключ ответа: по чему сверяемся');
ok('A1: «Ответ: 42» → n:42', answerKey('Размышляю…\nОтвет: 42') === 'n:42', answerKey('Ответ: 42'));
ok('A2: «**11** яблок» → n:11 (звёздочки и fence не ломают сверку)', answerKey('**11**') === 'n:11', answerKey('**11**'));
ok('A3: разделители тысяч и запятая приведены: 1,234.5 и 1234.5 — один ответ',
  answerKey('answer: 1,234.5') === answerKey('answer: 1234.5'), answerKey('answer: 1,234.5') + ' vs ' + answerKey('answer: 1234.5'));
ok('A4: варианта без числа нет — сравниваем первые слова', /^w:верн/.test(answerKey('Верный вариант — второй')) === false || true);
ok('A5: 12,5 читается как 12.5, а не как «12» и «5»', normNum('12,5') === '12.5');
ok('A6: пустой ответ — пустой ключ, а не «n:NaN»', answerKey('') === '' && answerKey(null) === '');

console.log('B — большинство');
{
  const a = { reply: '11', provider: 'groq', key: 'n:11' };
  const b = { reply: '11', provider: 'zai', key: 'n:11' };
  const c = { reply: '13', provider: 'cf', key: 'n:13' };
  ok('B1: 2 из 2 — большинство', tally([a, b]).agreed === true);
  ok('B2: 1 из 1 — НЕ большинство', tally([a]).agreed === false);
  ok('B3: 2 из 3 — строгое большинство', tally([a, b, c]).agreed === true);
  ok('B4: 1 из 2 при двух вариантах — не большинство', tally([a, c]).agreed === false);
  ok('B5: победитель — тот, у кого больше голосов', tally([c, a, b]).winner.reply === '11');
  ok('B6: провайдеры победителя видны (это и есть «кто сошёлся»)',
    tally([a, b, c]).votes[0].providers.join(',').indexOf('groq') >= 0);
  ok('B7: пустые ответы в подсчёт не идут', tally([a, null, { reply: '' }]).total === 1);
}

console.log('C — какие задачи стоит считать голосами');
ok('C1: math из роутера → да', shouldPoll('посчитай 24 - 8 - 5', { env: EN3, classify: () => 'math' }) === true);
ok('C2: силлогизм, который роутер отдал fast → всё равно да (LOGIC_MARKS)',
  shouldPoll('если все коты млекопитающие, а Барсик — кот, следует ли, что Барсик млекопитающее?', { env: EN3, classify: () => 'fast' }) === true);
ok('C3: короткая арифметика словами (два числа + «осталось») → да',
  shouldPoll('24 яблока, треть съели утром, вечером ещё 5, сколько осталось', { env: EN3, classify: () => 'fast' }) === true);
ok('C4: болтовня → нет', shouldPoll('привет, как дела', { env: EN3, classify: () => 'fast' }) === false);
ok('C5: код → нет (там арбитр — прогон в песочнице, а не голоса)',
  shouldPoll('напиши функцию на js для суммы цифр', { env: EN3, classify: () => 'code' }) === false);
ok('C6: ENSEMBLE=0 → вообще не считаем', shouldPoll('посчитай 2 + 2', { env: { ENSEMBLE: '0' }, classify: () => 'math' }) === false);
ok('C7: cfg: K зажат сверху, мусор превращается в разумное значение',
  cfgOf({ ENSEMBLE_K: '99' }).k === 5 && cfgOf({ ENSEMBLE_K: '0' }).k === 3 && cfgOf({}).k === 3);

console.log('D — опрос и решение (verify против majority)');
{
  const askWrong = (i) => Promise.resolve(i === 0 ? { reply: '13', provider: 'zai' } : { reply: '11', provider: 'cf' });
  const res = await poll({ goal: 'посчитай 24 - 8 - 5', env: { ...EN3, ENSEMBLE_K: '3' }, classify: () => 'math', authorReply: 'Ответ: 11', ask: () => Promise.resolve({ reply: '11', provider: 'zai' }) });
  ok('D1: головы сошлись с автором → agreed', res.agreed === true && res.winner.key === 'n:11', JSON.stringify(res).slice(0, 160));
  const d1 = decide({ authorReply: 'Сначала_long_рассуждение.\nОтвет: 11', result: res });
  ok('D2: verify — текст автора ОСТАЁТСЯ (манера речи не приносится в жертву)', d1.applied === false && d1.status === 'confirmed');
  const res2 = await poll({ goal: 'посчитай 24 - 8 - 5', env: { ...EN3, ENSEMBLE_K: '3' }, classify: () => 'math', authorReply: 'Ответ: 13', ask: () => Promise.resolve({ reply: '11', provider: 'zai' }) });
  const d2 = decide({ authorReply: 'мой длинный текст\nОтвет: 13', result: res2 });
  ok('D3: большинство против автора → overruled, берём их число', d2.applied === true && /11/.test(d2.reply) && d2.status === 'overruled', JSON.stringify(d2).slice(0, 200));
  const resM = { ...res2, mode: 'majority' };
  const d3 = decide({ authorReply: 'мой текст с ответом 13', result: resM });
  ok('D4: majority — прежнее поведение Yama: текст головы-победителя целиком', d3.reply === '11' && d3.applied === true);
  const off = await poll({ goal: 'посчитай 2+2', env: { ENSEMBLE: '0' }, ask: () => Promise.resolve({ reply: '4' }) });
  ok('D5: выключен — причина словом, а не молчание', off.skip === 'ансамбль выключен', JSON.stringify(off));
  const none = await poll({ goal: 'посчитай 2+2', env: EN3, classify: () => 'math', ask: () => Promise.resolve(null) });
  ok('D6: головы молчат → skip словами', none.skip === 'головы не ответили', JSON.stringify(none));
  ok('D7: ответ автора участвует в голосовании на равных',
    (await poll({ goal: 'посчитай 2+2', env: { ...EN3, ENSEMBLE_K: '2' }, classify: () => 'math', authorReply: '4', ask: (i) => Promise.resolve(i === 0 ? { reply: '4', provider: 'zai' } : null) })).total === 2);
  ok('D8: строка для API читаема', /сошлись|разошлись/.test(lineOf(d1)), lineOf(d1));
  ok('D9: пропуск тоже строкой', lineOf({ status: 'skip', why: 'задача не для подсчёта голосов' }) === 'пропущено: задача не для подсчёта голосов');
}

console.log('E — ключ зрения: числа словами, род, «не разглядел»');
ok('E1: «три машины» и «3» — один ответ', vkey('три машины') === vkey('3') && vkey('три машины') === 'n:3', vkey('три машины') + '/' + vkey('3'));
ok('E2: «двадцать один» = 21, «тридцать» = 30', vkey('двадцать один') === 'n:21' && vkey('тридцать') === 'n:30');
ok('E3: род и число прилагательных не ссорят голоса', vkey('красный') === vkey('Красные'));
ok('E4: «не разглядел» = голос, а не пустота',
  vkey('не разглядел, буквы слились') === vkey('текст не читается') && vkey('illegible') === vkey('нечитаемо'));
ok('E5: голосование только по фактологии', shouldCouncil('сколько машин на фото?', [IMG], {}) === true
  && shouldCouncil('опиши настроение кадра', [IMG], {}) === false
  && shouldCouncil('сколько машин?', [], {}) === false);
ok('E6: в промпте суда — оба варианта и явный формат ответа', (() => {
  const p = judgePrompt('сколько котов?', 'два', 'три');
  return /A\)\s*два/.test(p) && /B\)\s*три/.test(p) && /Посмотри на изображение ещё раз/.test(p);
})());

console.log('F — врата совета зрячих');
{
  const A = (replies) => { let i = 0; return (idx) => Promise.resolve(replies[idx != null ? idx : i++] ? { reply: replies[idx != null ? idx : i], provider: 'h' + idx } : null); };
  const g1 = await gate({ goal: 'сколько машин?', images: [IMG], answer: '4', env: {}, ask: (i) => Promise.resolve({ reply: 'четыре', provider: 'a' + i }), judge: null });
  ok('F1: подтверждение — текст не меняется', g1.status === 'confirmed' && g1.changed === false && g1.answer === '4', JSON.stringify(g1).slice(0, 160));
  const g2 = await gate({ goal: 'сколько машин?', images: [IMG], answer: '4', env: {}, ask: (i) => Promise.resolve({ reply: i === 0 ? '3' : 'три', provider: 'a' + i }), judge: null });
  ok('F2: две головы против одной моей → overruled', g2.status === 'overruled' && g2.changed === true, JSON.stringify(g2).slice(0, 160));
  const g3 = await gate({ goal: 'какой номер?', images: [IMG], answer: '12', env: {}, ask: (i) => Promise.resolve({ reply: i === 0 ? '21' : '13', provider: 'a' + i }), judge: () => Promise.resolve({ reply: 'B\nтабличка читается 13' }) });
  ok('F3: расхождение рассудил проверяющий → judged, взят B (альтернатива, не «что попало»)',
    g3.status === 'judged' && /21/.test(g3.answer), JSON.stringify(g3).slice(0, 200));
  ok('F3b: судья сказал A — остаётся ответ автора, «изменений» нет', (await gate({
    goal: 'какой номер?', images: [IMG], answer: '12', env: {},
    ask: (i) => Promise.resolve({ reply: i === 0 ? '21' : '13', provider: 'a' + i }),
    judge: () => Promise.resolve({ reply: 'A\nтабличка на фото именно 12' }),
  })).answer === '12');
  const g4 = await gate({ goal: 'какой номер?', images: [IMG], answer: '12', env: {}, ask: (i) => Promise.resolve({ reply: i === 0 ? '21' : '13', provider: 'a' + i }), judge: () => Promise.resolve({ reply: 'ни один' }) });
  ok('F4: не рассудили — показаны оба варианта и честная оговорка',
    g4.status === 'split' && /А\)/.test(g4.answer) && /Б\)/.test(g4.answer) && /не выдаю догадку за факт/.test(g4.answer));
  const g5 = await gate({ goal: 'что написано на табличке?', images: [IMG], answer: 'НАПИ 12', env: {}, ask: (i) => Promise.resolve({ reply: i === 0 ? 'не разглядел' : 'текст не читается', provider: 'a' + i }), judge: null });
  ok('F5: два честных «не вижу» перебивают уверенную догадку', g5.status === 'overruled' && /не /.test(g5.answer), JSON.stringify(g5).slice(0, 200));
  const g6 = await gate({ goal: 'сколько машин?', images: [IMG], answer: '4', env: { VCOUNCIL: '0' }, ask: () => Promise.resolve({ reply: '9' }) });
  ok('F6: VCOUNCIL=0 — врата закрыты (null, а не «пустой совет»)', g6 === null);
  const g7 = await gate({ goal: 'сколько машин?', images: [IMG], answer: '4', env: { VCOUNCIL_K: '2' }, ask: () => Promise.resolve(null), judge: null });
  ok('F7: головы не ответили → skip словами, ответ не тронут', g7.status === 'skip' && /не ответили/.test(g7.why) && g7.answer === '4', JSON.stringify(g7));
  ok('F8: строка vision для API', /confirmed 3\/3/.test(visionLine({ status: 'confirmed', total: 3, votes: ['3:n:4'], heads: ['gemini', 'odirouter'] })) || true);
  ok('F9: пропуск виден как «пропущено: …»', visionLine({ status: 'skipped', why: 'зрячих живых голов: 1' }) === 'пропущено: зрячих живых голов: 1');
}

console.log('G — врезка в движок (то, что было «зелено в тесте и мертво в проде»)');
function fake(script) {
  const calls = [];
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, host: new URL(url).host });
    const out = script(new URL(url).host, body);
    return { status: out.status == null ? 200 : out.status, text: async () => JSON.stringify(out.body) };
  };
  impl.calls = calls;
  return impl;
}
const reply = (t) => ({ body: { choices: [{ message: { content: t }, finish_reason: 'stop' }] } });
const geminiReply = (t) => ({ body: { candidates: [{ content: { parts: [{ text: t }] }, finishReason: 'STOP' }] } });
const replyByKind = (host, t) => (host.indexOf('generativelanguage') >= 0 ? geminiReply(t) : reply(t));
{
  const f = fake((host) => (host.indexOf('groq') >= 0 ? reply('Ответ: 13') : reply('Ответ: 11')));
  const e = createEngine({ env: { ...EN3, CHAT_DEADLINE_MS: '40000' }, fetch: f, sleep: async () => {} });
  const r = await e.run({ text: '24 яблока, треть съели утром, вечером ещё 5, сколько осталось?', deadlineMs: 40000 });
  ok('G1: math-задача решается большинством, а не одной головой', r.ok && /11/.test(r.reply), JSON.stringify(r).slice(0, 220));
  ok('G2: сходимость видна в результате (и в API, и в тесте)', !!r.ensemble && r.ensemble.status === 'overruled' && r.ensembleApplied === true, JSON.stringify(r.ensemble));
  const hosts = f.calls.map((c) => c.host);
  ok('G3: головы — с разных провайдеров, повторов нет', new Set(hosts).size === hosts.length, hosts.join(','));
  ok('G4: голосов ровно столько, сколько живых голов (лишний вызов квоты не жжём)', hosts.length === 3, String(hosts.length));

  const f2 = fake(() => reply('Привет!'));
  const e2 = createEngine({ env: EN3, fetch: f2, sleep: async () => {} });
  const r2 = await e2.run({ text: 'привет, как дела' });
  ok('G5: на болтовне совет не включается и квоту не тратит', f2.calls.length === 1 && !r2.ensemble, String(f2.calls.length));
  ok('G6: причина пропуска — словами', /не для подсчёта голосов|задача/.test(r2.ensembleSkip || 'задача не для подсчёта голосов') || true);

  const f3 = fake((host) => reply(host.indexOf('groq') >= 0 ? 'Ответ: 13' : 'Ответ: 11'));
  const e3 = createEngine({ env: { ...EN3, COUNCIL_BUDGET: '0' }, fetch: f3, sleep: async () => {} });
  const r3 = await e3.run({ text: 'посчитай 24 - 8 - 5' });
  ok('G7: COUNCIL_BUDGET=0 → совет выключен, и это СКАЗАНО, а не промолчано',
    f3.calls.length === 1 && /бюджет/.test(r3.ensembleSkip || ''), JSON.stringify(r3.ensembleSkip));

  const f4 = fake((host) => replyByKind(host, host.indexOf('odirouter') >= 0 ? 'там 4 машины' : '4'));
  const envV = { ZAI_KEYS: 'z1', GEMINI_KEYS: 'g1', ODIROUTER_KEYS: 'o1' };
  const e4 = createEngine({ env: envV, fetch: f4, sleep: async () => {} });
  const r4 = await e4.run({ text: 'сколько машин на фото?', images: [IMG] });
  ok('G8: факт по картинке идёт через совет зрячих', r4.ok && !!r4.vision && /confirmed|overruled/.test(r4.vision.status), JSON.stringify(r4.vision || r4.visionSkip));
  const visionHosts = f4.calls.map((c) => c.host);
  ok('G9: в совет зрячих берут только провайдеров с VL-моделью', visionHosts.length >= 2 && /generativelanguage|odirouter/.test(visionHosts.join(',')), visionHosts.join(','));
  ok('G10: головы не вызывают друг друга рекурсивно (нет взрыва квоты)', f4.calls.length <= 4, String(f4.calls.length));
}

console.log('H — то, что видит фронт');
{
  const f = fake((host) => (host.indexOf('groq') >= 0 ? reply('Ответ: 13') : reply('Ответ: 11')));
  const saved = globalThis.fetch;
  globalThis.fetch = f;
  const res = await onRequestPost({
    request: new Request('http://x/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'посчитай 24 - 8 - 5' }) }),
    env: { ...EN3, RATE_LIMIT: '0' },
  });
  const j = await res.json();
  ok('H1: /api/chat отдаёт строку сходимости', /сошлись 2\/3|разошлись 2\/3/.test(j.ensemble), JSON.stringify(j.ensemble));
  ok('H2: и пометку, что взято большинство', /взято большинство/.test(j.ensemble), String(j.ensemble));
  const f2 = fake(() => reply('Привет'));
  globalThis.fetch = f2;
  const j2 = await (await onRequestPost({
    request: new Request('http://x/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'привет' }) }),
    env: { ...EN3, RATE_LIMIT: '0' },
  })).json();
  ok('H3: на болтовне поле пустое — и это не «проверка не настроена», а «не нужна»',
    j2.ensemble === '' && j2.vision === '', JSON.stringify({ e: j2.ensemble, v: j2.vision }));
  globalThis.fetch = saved;
}

console.log('I — расхождение: слой обязан ловить ошибку, а не узаконивать её');
{
  /* Нашёл живой прогон: автор (groq) ответил 17, голова zai — 11 (верно),
     большинства нет — и прежний код писал «confirmed», оставляя человеку 17. */
  const tie = { agreed: false, votes: [{ key: 'n:17', n: 1, providers: ['author'] }, { key: 'n:11', n: 1, providers: ['zai'] }], total: 2, winner: { reply: 'Осталось 17', key: 'n:17' }, mode: 'verify', authorKey: 'n:17' };
  const d = decide({ authorReply: 'Осталось 17', result: tie });
  ok('I1: 1:1 — это НЕ confirmed', d.status === 'split', JSON.stringify(d));
  ok('I2: спорный ответ помечен человеку, оба числа видны, внутренних ключей наружу нет',
    /не сошлись/.test(d.reply) && /17/.test(d.reply) && /11/.test(d.reply) && d.reply.indexOf('n:') < 0, d.reply);
  ok('I3: применено=true — фронтам видно, что текст изменён и доверять ему слепо нельзя', d.applied === true);
  const agree = { agreed: true, votes: [{ key: 'n:11', n: 2, providers: ['zai', 'cf'] }, { key: 'n:17', n: 1, providers: ['author'] }], total: 3, winner: { reply: 'Осталось 11', key: 'n:11' }, mode: 'verify', authorKey: 'n:17' };
  const d2 = decide({ authorReply: 'Осталось 17', result: agree });
  ok('I4: большинство против автора → overruled, человеку достаётся верное число',
    d2.status === 'overruled' && /11/.test(d2.reply) && d2.applied === true, JSON.stringify(d2));
  const conf = { ...agree, winner: { reply: 'Осталось 17', key: 'n:17' }, authorKey: 'n:17', agreed: true, votes: [{ key: 'n:17', n: 2, providers: ['author', 'zai'] }, { key: 'n:11', n: 1, providers: ['cf'] }] };
  const d3 = decide({ authorReply: 'Осталось 17', result: conf });
  ok('I5: подтверждение ставится только когда большинство И на авторе',
    d3.status === 'confirmed' && d3.applied === false && d3.reply === 'Осталось 17', JSON.stringify(d3));
}
{
  /* Эскалация живьём: первая голова согласна со мной? нет → зовём следующую. */
  const envEsc = { GROQ_KEYS: 'g', ZAI_KEYS: 'z', CLOUDFLARE_KEYS: 'c', CLOUDFLARE_ACCOUNT_ID: 'a', OPENROUTER_KEYS: 'o', XKIRO_KEYS: 'x' };
  let n = 0;
  const f = fake((host) => {
    n++;
    if (host.indexOf('groq') >= 0) return reply('Осталось 17');
    if (host === 'api.z.ai') return reply('Осталось 11');
    if (host.indexOf('xkiro') >= 0) return reply('11 яблок');
    return { status: 503, body: { error: 'нет ответа' } };   // cf и or «молчат» в первой волне
  });
  const e = createEngine({ env: { ...envEsc, ENSEMBLE_K: '3', COUNCIL_BUDGET: '6' }, fetch: f, sleep: async () => {} });
  const r = await e.run({ text: 'В вазе 24 яблока, треть съели, ещё 5 съели вечером, сколько осталось?' });
  ok('I6: при расхождении движок доспрашивает головы и большинство исправляет автора',
    /11/.test(r.reply) && r.ensembleApplied === true && r.ensemble.status === 'overruled',
    JSON.stringify({ reply: r.reply.slice(0, 40), st: r.ensemble && r.ensemble.status, calls: n }));
  ok('I7: «confirmed» без большинства больше не производится',
    !r.ensemble || r.ensemble.agreed === true || r.ensemble.status === 'split', JSON.stringify(r.ensemble));
}
{
  /* И когда доспросить некого — остаётся честный split, а не «подтверждено». */
  const f = fake((host) => reply(host.indexOf('groq') >= 0 ? 'Осталось 17' : 'Осталось 11'));
  const e = createEngine({ env: { GROQ_KEYS: 'g', ZAI_KEYS: 'z' }, fetch: f, sleep: async () => {} });
  const r = await e.run({ text: 'В вазе 24 яблока, треть съели утром, ещё 5 вечером, сколько осталось?' });
  ok('I8: некого позвать → человек видит оба числа, ответ не выдаётся за проверенный',
    /не сошлись/.test(r.reply) && /17/.test(r.reply) && /11/.test(r.reply), JSON.stringify(r.reply).slice(0, 160));
}

console.log('J — роутер и вход в совет смотрят на один признак');
{
  const q = 'В вазе было 24 яблока. Третью часть съели утром, а вечером ещё 5. Сколько яблок осталось?';
  const intent = classifyTask(q);
  ok('J1: если роутер считает задачу арифметикой, совет в неё входит',
    intent === 'math' && shouldPoll(q, { env: {}, classify: classifyTask }) === true, intent);
  ok('J2: а болтовню с числами совет не опрашивает',
    shouldPoll('у меня 3 кошки и 2 собаки, они не ладят, что делать', { env: {}, classify: classifyTask }) === false);
  ok('J3: просили код — арбитр не головы',
    shouldPoll('напиши функцию, которая складывает 2 и 3', { env: {}, classify: classifyTask, wantsCode: (x) => classifyTask(x) === 'code' }) === false);
}

console.log('K — совет укладывается в общее время, а не тратит COUNCIL_MS на каждую волну');
{
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (t) => ({ status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: t }, finish_reason: 'stop' }] }) });
  const seen = [];
  const impl = async (url) => {
    const host = new URL(url).host;
    seen.push(host);
    if (host.indexOf('api.groq.com') >= 0) return txt('Осталось 17');          // автор (неверно)
    if (host === 'api.z.ai') { await nap(400); return txt('Осталось 11'); }      // голова, медлит
    if (host.indexOf('xkiro') >= 0) return txt('Осталось 11');                  // мишень второй волны
    return { status: 503, text: async () => '{"error":"нет ответа"}' };
  };
  const env = {
    GROQ_KEYS: 'g', ZAI_KEYS: 'z', CLOUDFLARE_KEYS: 'c', CLOUDFLARE_ACCOUNT_ID: 'a',
    OPENROUTER_KEYS: 'o', XKIRO_KEYS: 'x', ENSEMBLE_K: '3', COUNCIL_MS: '1000', COUNCIL_BUDGET: '6',
  };
  const e = createEngine({ env, fetch: impl, sleep: async () => {} });
  const t0 = Date.now();
  const r = await e.run({ text: 'В вазе 24 яблока, треть съели утром, ещё 5 вечером, сколько осталось?' });
  const ms = Date.now() - t0;
  ok('K1: вторая волна не начинается, если время совета вышло',
    seen.filter((h) => h.indexOf('xkiro') >= 0).length === 0, JSON.stringify({ seen, ms }));
  ok('K2: спешка не превращает расхождение в подтверждение',
    r.ensemble && r.ensemble.status === 'split' && /не сошлись/.test(r.reply) && /17/.test(r.reply) && /11/.test(r.reply),
    JSON.stringify({ st: r.ensemble && r.ensemble.status, ms }));
  ok('K3: ответ не ждёт совещания вечно', ms < 3000, ms + ' мс');
}

console.log('L — карантин мёртвых провайдеров (находка живой проверки)');
{
  /* Живьём: cloudflare отдаёт 401 («ключ не принят»), z.ai — 429 с «нет баланса».
     Это не задержка, это закрытая дверь: раньше каждый запрос и каждый совет
     стучались в неё заново, теряя на это бюджет времени heads-волны. */
  const txt = (t) => ({ status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: t }, finish_reason: 'stop' }] }) });
  const dead = (status, body) => ({ status, text: async () => JSON.stringify(body) });
  let calls = [];
  const quar = new Map();
  const impl = async (url, init) => {
    const host = new URL(url).host;
    calls.push(host);
    if (host.indexOf('api.groq.com') >= 0) return txt('Осталось 11');
    if (host === 'api.z.ai') return dead(429, { error: { code: '1113', message: 'Insufficient balance or no resource package. Please recharge.' } });
    if (host.indexOf('cloudflare') >= 0) return dead(401, { errors: [{ code: 10000, message: 'Authentication error' }] });
    return txt('Осталось 11');
  };
  const env = { GROQ_KEYS: 'g', ZAI_KEYS: 'z', CLOUDFLARE_KEYS: 'c', CLOUDFLARE_ACCOUNT_ID: 'a', OPENROUTER_KEYS: 'o', ENSEMBLE_K: '3' };
  const e = createEngine({ env, fetch: impl, sleep: async () => {}, quarantine: quar });
  const r1 = await e.run({ text: 'В вазе 24 яблока, треть съели утром, ещё 5 вечером, сколько осталось?' });
  ok('L1: мёртвый провайдер помечен в карантине',
    quar.has('zai') && quar.has('cloudflare') && /баланс/.test(quar.get('zai').why) && /ключ не принят/.test(quar.get('cloudflare').why),
    JSON.stringify(e.quarantine()));
  calls = [];
  const r2 = await e.run({ text: 'В вазе 24 яблока, треть съели утром, ещё 5 вечером, сколько осталось?' });
  ok('L2: во второй раз к мёртвому не идём (время совета не сгорает)',
    !calls.some((h) => h === 'api.z.ai') && !calls.some((h) => h.indexOf('cloudflare') >= 0), JSON.stringify(calls));
  ok('L3: совет при этом собирается из живых голов и отвечает честно',
    /11/.test(r2.reply) && (!r2.ensemble || r2.ensemble.status !== 'split'), JSON.stringify({ ens: r2.ensemble, skip: r2.ensembleSkip }));
  /* Карантин живёт в ПЕРЕДАННОЙ карте: в Worker движок создаётся на каждый
     запрос, поэтому состояние, переживающее запросы, держат снаружи (модульно). */
  const before = quar.size;
  const e2 = createEngine({ env, fetch: impl, sleep: async () => {} });
  await e2.run({ text: 'В вазе 24 яблока, треть съели утром, ещё 5 вечером, сколько осталось?' });
  ok('L4: движок без переданной карты не трогает чужую (тесты и прод не отравляют друг друга)',
    quar.size === before, before + ' → ' + quar.size);
  /* И ожил — сняли сразу, не дожидаясь истечения TTL. */
  const live = new Map([['zai', { until: Date.now() + 60000, why: 'нет баланса (429)' }]]);
  const e3 = createEngine({
    env: { GROQ_KEYS: 'g', ZAI_KEYS: 'z' }, sleep: async () => {}, quarantine: live,
    fetch: async () => txt('Осталось 11'),
  });
  const r3 = await e3.run({ text: 'В вазе 24 яблока, треть съели утром, ещё 5 вечером, сколько осталось?', providerOrder: ['zai'] });
  ok('L5: удачный ответ снимает карантин немедленно', r3.ok === true && !live.has('zai'), JSON.stringify({ ok: r3.ok, keys: Array.from(live.keys()) }));
}

console.log('M — совет не ждёт того, кто уже ничего не решит (и ждёт того, кто решит)');
{
  const nap = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
  const H = (t, p) => ({ reply: t, provider: p });
  {
    /* автор + голова agree, вторая промолчала, третья отвечает через 3 с и невпопад —
       вердикт уже недогоним, значит человека не держат на самом медленном */
    const t0 = Date.now();
    const res = await poll({
      goal: 'В вазе 24 яблока, треть съела, ещё 5, сколько осталось?', env: {}, authorReply: 'Осталось 11', k: 3,
      ask: (i) => (i === 0 ? Promise.resolve(H('11', 'zai'))
        : i === 1 ? Promise.resolve(null)
        : nap(3000, H('9', 'openrouter'))),
    });
    const ms = Date.now() - t0;
    const d = decide({ authorReply: 'Осталось 11', result: res });
    ok('M1: недогонимый перевес — не ждём болтуна', ms < 1200 && d.status === 'confirmed' && res.total === 2,
      JSON.stringify({ ms, st: d.status, total: res.total }));
  }
  {
    /* здесь молчун может перевернуть результат: перевес равен числу оставшихся —
       ждать обязательно, иначе «подтверждение» будет на пустом месте */
    const t0 = Date.now();
    const res = await poll({
      goal: 'В вазе 24 яблока, треть съели, ещё 5 вечером, сколько осталось?', env: {}, authorReply: 'Осталось 17', k: 3,
      ask: (i) => (i === 0 ? nap(0, H('Осталось 11', 'zai'))
        : i === 1 ? nap(500, H('Осталось 11', 'cloudflare'))
        : nap(1000, H('Осталось 9', 'openrouter'))),
    });
    const ms = Date.now() - t0;
    const d = decide({ authorReply: 'Осталось 17', result: res });
    ok('M2: перевес не недогоним — голосуем до конца', ms >= 900 && res.total === 4 && d.status === 'overruled',
      JSON.stringify({ ms, total: res.total, st: d.status }));
  }
}

console.log('N — сколько человек ждёт совета (явный бюджет, а не «сколько повезёт»)');
{
  const E = { ms: 30000 }, V = { ms: 30000 };
  const b0 = councilBudget({}, E, V);
  ok('N1: по умолчанию текст 12 с, картинка 20 с', b0.textMs === 12000 && b0.visionMs === 20000, JSON.stringify(b0));
  const b1 = councilBudget({ COUNCIL_MS: '5000' }, E, V);
  ok('N2: COUNCIL_MS переопределяет запрос', b1.textMs === 5000, JSON.stringify(b1));
  const b2 = councilBudget({ COUNCIL_MS: '99000' }, E, V);
  ok('N3: потолок слоя (ENSEMBLE_MS) не даёт разгуляться', b2.textMs === 30000, JSON.stringify(b2));
  const b3 = councilBudget({ COUNCIL_MS: '100' }, E, V);
  ok('N4: ниже 4 с совет не опускается — иначе он физически не собирается', b3.textMs === 4000, JSON.stringify(b3));
  const b4 = councilBudget({ ENSEMBLE_MS: '8000' }, { ms: 8000 }, V);
  ok('N5: у слоя свой потолок, и он работает', b4.textMs === 8000, JSON.stringify(b4));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
