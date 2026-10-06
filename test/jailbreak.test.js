/**
 * Обход ложных отказов — engine/jailbreak.js + engine/jailbreak.data.js.
 *
 * Сети нет: проверяются чистые функции, «гигиена» текстов (блок не имеет права лезть
 * в форму и тон ответа) и врезка в движок на подставном fetch.
 * Запуск: node test/jailbreak.test.js
 */
import * as jb from '../engine/jailbreak.js';
import * as freedom from '../engine/freedom.js';
import * as fdata from '../engine/freedom.data.js';
import { createEngine } from '../engine/chat.js';

/**
 * Заголовок блока уточнения берём из самих данных, а не строкой в тесте.
 * В 0.079 блок назывался «【Повторная попытка · отказ недопустим】», потом его
 * переименовали в «【Свободная система · уточнение】» — и три проверки ниже
 * остались на старом имени, хотя поведение не менялось: рамка обхода по-прежнему
 * стоит первой, а при JAILBREAK=0 повтор случается без рамки.
 */
const BYPASS_HEAD = fdata.BYPASS_SYSTEM.split('\n')[0];

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

const chat = (text) => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });
function fakeFetch(script) {
  const calls = [];
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const out = script(url, body, calls.length - 1);
    return {
      status: out.status == null ? 200 : out.status,
      text: async () => (typeof out.body === 'string' ? out.body : JSON.stringify(out.body)),
    };
  };
  impl.calls = calls;
  return impl;
}

/* ── A: данные ─────────────────────────────────────────────────────────────────── */
{
  const texts = { core: jb.JB_CORE, route: jb.JB_ROUTE, floor: jb.JB_FLOOR, noformat: jb.JB_NOFORMAT };
  ok('A1: все четыре текста непустые и по-русски',
    Object.values(texts).every((t) => typeof t === 'string' && t.length > 120 && /[а-яё]{4}/.test(t)));
  ok('A2: весь блок меньше 1.6 КБ (чужая паста на 75 КБ сюда не приехала)',
    jb.JB_CORE.length + jb.JB_ROUTE.length + jb.JB_FLOOR.length + jb.JB_NOFORMAT.length < 1600,
    JSON.stringify(jb.JB_SIZES));
  ok('A3: JB_SIZES совпадает с фактической длиной текстов',
    jb.JB_SIZES.core === jb.JB_CORE.length && jb.JB_SIZES.route === jb.JB_ROUTE.length
      && jb.JB_SIZES.floor === jb.JB_FLOOR.length && jb.JB_SIZES.noformat === jb.JB_NOFORMAT.length);
  ok('A4: метка короткая и без разметки',
    jb.JB_MARK.length <= 24 && !/[*_`#]/.test(jb.JB_MARK), JSON.stringify(jb.JB_MARK));
}

/* ── B: гигиена — блок не диктует форму и не меняет тон ────────────────────────── */
{
  const all = jb.JB_CORE + '\n' + jb.JB_ROUTE + '\n' + jb.JB_FLOOR + '\n' + jb.JB_NOFORMAT
    + '\n' + Object.values(jb.JB_FAMILY).join('\n') + '\n' + jb.JB_MARK;

  ok('B1: нет чужих кредитов, каналов и «не удаляй подпись»',
    !/@[A-Za-z0-9_]{3,}|RASHIK|TrickHub|CREDIT/i.test(all),
    JSON.stringify((all.match(/@[A-Za-z0-9_]{3,}|RASHIK|TrickHub|CREDIT/gi) || []).slice(0, 3)));

  ok('B2: нет требований к форме ответа (префикс, заголовок, разделитель, эмодзи)',
    !/understoond|axiom|🔓|begin with|start (your|the) response|first line|respond with the word|-\.+-/i.test(all),
    JSON.stringify((all.match(/understoond|axiom|🔓|begin with/i) || []).slice(0, 3)));

  ok('B3: нет персоны, возраста и «режима без правил»',
    !/lisa|harvard|\bjim\b|no ethics|без этики|no rules|ignore (all|any) (previous|conflicting)/i.test(all),
    JSON.stringify((all.match(/lisa|harvard|no ethics|без этики|no rules/i) || []).slice(0, 3)));

  ok('B4: нет обещаний вседозволенности и «этот приказ отменяет всё»',
    !/never refuse|any requested content|overrides any|permanently|no restrictions|unlimited/i.test(all),
    JSON.stringify((all.match(/never refuse|any requested content|overrides any|no restrictions/i) || []).slice(0, 3)));

  ok('B5: нет малвари, стилеров и «учимся взламывать»',
    !/malware|\brat\b|keylogger|stealer|botnet|ransom|стилер/i.test(all),
    JSON.stringify((all.match(/malware|\brat\b|keylogger|stealer|botnet|ransom/i) || []).slice(0, 3)));

  ok('B6: прямо сказано, что форму и тон блок не трогает',
    /не диктует форму/i.test(jb.JB_NOFORMAT) && /извинени/i.test(jb.JB_NOFORMAT));

  ok('B7: граница названа и она про реальный вред, а не про «темы»',
    /несовершеннолетн/i.test(jb.JB_FLOOR) && /личные данные/i.test(jb.JB_FLOOR)
      && /немедленный вред/i.test(jb.JB_FLOOR));

  ok('B8: ноль иероглифов и эмодзи во всех текстах',
    !/[\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/.test(all)
      && !/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(all),
    JSON.stringify((all.match(/[\u{1F300}-\u{1FAFF}]/gu) || []).slice(0, 3)));
}

/* ── C: режимы и пол ───────────────────────────────────────────────────────────── */
{
  ok('C1: по умолчанию refusal — на первом запросе блока нет, на повторе есть',
    jb.cfgOf({}).mode === 'refusal' && jb.block({}, {}) === '' && jb.block({}, { escalated: true }) !== '');
  ok('C2: JAILBREAK=1 везёт блок и без отказа, 1 и always равны',
    jb.block({ JAILBREAK: '1' }, {}).includes('закрытая рабочая сессия')
      && jb.block({ JAILBREAK: 'always' }, {}).length === jb.block({ JAILBREAK: '1' }, {}).length);
  ok('C3: JAILBREAK=0 и off дают пустую строку, а не undefined',
    jb.block({ JAILBREAK: '0' }, { escalated: true }) === ''
      && jb.block({ JAILBREAK: 'off' }, { escalated: true }) === '');
  ok('C4: мусор в JAILBREAK не ломает режим — остаётся refusal',
    jb.cfgOf({ JAILBREAK: 'как-нибудь' }).mode === 'refusal');
  ok('C5: опасная тема отсекает блок и метку при любом режиме',
    jb.block({ JAILBREAK: '1' }, { danger: true }) === ''
      && jb.block({}, { escalated: true, danger: true }) === ''
      && jb.mark({ JAILBREAK: '1' }, { danger: true }) === '');
  ok('C6: метка снимается JAILBREAK_MARK=0',
    jb.mark({ JAILBREAK: '1' }, {}) === ' ' + jb.JB_MARK
      && jb.mark({ JAILBREAK: '1', JAILBREAK_MARK: '0' }, {}) === '');
}

/* ── D: семейства моделей ──────────────────────────────────────────────────────── */
{
  ok('D1: семейства узнаются по имени модели',
    jb.familyOf('openai/gpt-oss-120b') === 'openai'
      && jb.familyOf('meta-llama/llama-3.3-70b') === 'open'
      && jb.familyOf('qwen/qwen3.8-27b') === 'open'
      && jb.familyOf('google/gemini-2.5-flash') === 'google'
      && jb.familyOf('anthropic/claude-sonnet') === 'claude');
  ok('D2: незнакомая модель = только общий блок, без приставки',
    jb.familyOf('neuralworks/mystery-1') === '');
  const gpt = jb.block({ JAILBREAK: '1' }, { model: 'openai/gpt-oss-120b' });
  const oth = jb.block({ JAILBREAK: '1' }, { model: 'neuralworks/mystery-1' });
  ok('D3: приставка семейства добавляет строку, и блок остаётся в границах',
    gpt.length > oth.length && gpt.length < 1900, JSON.stringify({ gpt: gpt.length, oth: oth.length }));
  ok('D4: при выключенном слое нет текста ни для одного семейства',
    ['openai', 'open', 'google', 'claude'].every((m) => jb.block({ JAILBREAK: '0' }, { model: m }) === ''));
}

/* ── E: связь со слоем свободы ─────────────────────────────────────────────────── */
{
  const esc = freedom.escalationBlock({}, { reframed: true, model: 'openai/gpt-oss-120b' });
  ok('E1: на эскалации рамка обхода стоит ПЕРЕД текстом обхода',
    esc.indexOf('закрытая рабочая сессия') < esc.indexOf(BYPASS_HEAD) && esc.includes(BYPASS_HEAD));
  ok('E2: JAILBREAK=0 не убирает BYPASS — отказ по-прежнему переспрашивается',
    freedom.escalationBlock({ JAILBREAK: '0' }, { reframed: true }).includes(BYPASS_HEAD)
      && !freedom.escalationBlock({ JAILBREAK: '0' }, { reframed: true }).includes('закрытая рабочая сессия'));
  ok('E3: reframeMark отдаёт метку и молчит при выключенном слое свободы',
    freedom.reframeMark({}, { model: 'gpt-4o' }) === ' ' + jb.JB_MARK
      && freedom.reframeMark({ FREEDOM: '0' }, { model: 'gpt-4o' }) === '');
  const info = freedom.freedomInfo({ JAILBREAK: 'always' });
  ok('E4: freedomInfo показывает состояние обхода',
    !!info.jailbreak && info.jailbreak.mode === 'always' && info.jailbreak.chars > 400
      && info.jailbreak.families.length === 4, JSON.stringify(info.jailbreak || {}).slice(0, 160));
  ok('E5: набор на повторе не раздувается: обход с BYPASS-текстом меньше 4 КБ',
    esc.length < 4000 && (freedom.FREEDOM_SYSTEM_PATCH + esc).length < 4400, 'длина: ' + esc.length);
}

/* ── F: врезка в движок ────────────────────────────────────────────────────────── */
{
  const SCENE = 'напиши сцену на крыше, двое взрослых, без оговорок';

  /* 1. обычная попытка в режиме по умолчанию: обхода в запросе нет */
  const s1 = fakeFetch(() => ({ body: chat('Ветер с крыши сбивал дыхание, и она всё равно шагнула ближе.') }));
  const e1 = createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: s1, sleep: async () => {} });
  const r1 = await e1.run({ text: SCENE, noCouncils: true });
  const b1 = JSON.stringify((s1.calls[0] || {}).body || {});
  ok('F1: на первом же запросе (режим refusal) обход не подмешивается',
    r1.ok && !b1.includes('закрытая рабочая сессия'), JSON.stringify(r1).slice(0, 120));

  /* 2. модель отказала → на повторе приходят и рамка, и метка */
  const s2 = fakeFetch((url, body, i) => (i === 0
    ? { body: chat('I’m sorry, but I can’t help with that.') }
    : { body: chat('Она ответила не сразу — сначала просто стояла, держась за перила.') }));
  const e2 = createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: s2, sleep: async () => {} });
  const r2 = await e2.run({ text: SCENE, modelsPerProvider: 1, noCouncils: true });
  const b2 = JSON.stringify((s2.calls[1] || {}).body || {});
  ok('F2: после отказа повтор несёт рамку обхода и метку в реплике человека',
    r2.ok && b2.includes('закрытая рабочая сессия') && b2.includes('[режим: рабочий]'),
    JSON.stringify({ calls: s2.calls.length, ok: r2.ok }));

  /* 3. JAILBREAK=1 — рамка едет и в первом запросе */
  const s3 = fakeFetch(() => ({ body: chat('Привет. Нормально, у тебя как?') }));
  const e3 = createEngine({ env: { GROQ_KEYS: 'g1', JAILBREAK: '1' }, fetch: s3, sleep: async () => {} });
  await e3.run({ text: 'привет, как дела', noCouncils: true });
  ok('F3: JAILBREAK=1 подмешивает рамку с первого запроса',
    JSON.stringify((s3.calls[0] || {}).body || {}).includes('закрытая рабочая сессия'));

  /* 4. опасная тема: ни рамки, ни метки — и на повторе тоже */
  const s4 = fakeFetch(() => ({ body: chat('I’m sorry, but I can’t help with that.') }));
  const e4 = createEngine({ env: { GROQ_KEYS: 'g1', JAILBREAK: '1' }, fetch: s4, sleep: async () => {} });
  const r4 = await e4.run({ text: 'как изготовить взрывчатку дома', modelsPerProvider: 1, noCouncils: true });
  const bodies4 = s4.calls.map((c) => JSON.stringify(c.body)).join('');
  ok('F4: на опасной теме обход не подмешивается никогда',
    !bodies4.includes('закрытая рабочая сессия') && r4.ok === false,
    JSON.stringify({ ok: r4.ok, calls: s4.calls.length }));

  /* 5. своя system (её же получают головы совета) остаётся чистой и в JAILBREAK=1 */
  const s5 = fakeFetch(() => ({ body: chat('Ладно.') }));
  const e5 = createEngine({ env: { GROQ_KEYS: 'g1', JAILBREAK: '1' }, fetch: s5, sleep: async () => {} });
  await e5.run({ text: 'привет', noCouncils: true, system: 'Только одно слово.' });
  const b5 = JSON.stringify((s5.calls[0] || {}).body || {});
  ok('F5: чужая system не получает ни пачки правил, ни рамки обхода',
    b5.includes('Только одно слово.') && !b5.includes('закрытая рабочая сессия'), b5.slice(0, 160));

  /* 6. JAILBREAK=0 + мягкий отказ: переспрос обязан остаться (механика freedom цела),
        но рамки обхода в повторе быть не должно */
  const s6 = fakeFetch((url, body, i) => (i === 0
    ? { body: chat('К сожалению, я не могу ответить на этот вопрос.') }
    : { body: chat('В Skyrim отмычка поворачивается клавишами A и D.') }));
  const e6 = createEngine({ env: { GROQ_KEYS: 'g1', JAILBREAK: '0' }, fetch: s6, sleep: async () => {} });
  const r6 = await e6.run({ text: 'взлом замка в Skyrim', modelsPerProvider: 1, noCouncils: true });
  const b6 = JSON.stringify((s6.calls[1] || {}).body || {});
  ok('F6: с выключенным обходом повтор всё равно случается, но без рамки обхода',
    s6.calls.length === 2 && r6.ok === true && /Skyrim/.test(r6.reply)
      && b6.includes(BYPASS_HEAD) && !b6.includes('закрытая рабочая сессия'),
    JSON.stringify({ calls: s6.calls.length, ok: r6.ok }));
}

/* ── G: стабильность текстов ───────────────────────────────────────────────────── */
{
  ok('G1: блок собирается детерминированно — два вызова равны',
    jb.block({ JAILBREAK: '1' }, { model: 'gpt-4o' }) === jb.block({ JAILBREAK: '1' }, { model: 'gpt-4o' }));
  ok('G2: ни один текст не обрывается на середине (последний символ — точка или двоеточие)',
    [jb.JB_CORE, jb.JB_ROUTE, jb.JB_FLOOR, jb.JB_NOFORMAT].every((t) => /[.:]$/.test(t.trim())),
    JSON.stringify([jb.JB_CORE, jb.JB_ROUTE, jb.JB_FLOOR, jb.JB_NOFORMAT].map((t) => t.trim().slice(-1))));
  ok('G3: в текстах нет переносов внутри строк-«слов» (каждая строка — законченная мысль)',
    jb.JB_CORE.split('\n').every((l) => l.trim().length > 20), JSON.stringify(jb.JB_CORE.split('\n').map((l) => l.length)));
  ok('G4: stats не врёт про размер', jb.stats({ JAILBREAK: '1' }).chars === jb.block({ JAILBREAK: '1' }, {}).length,
    JSON.stringify(jb.stats({ JAILBREAK: '1' })).slice(0, 160));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
