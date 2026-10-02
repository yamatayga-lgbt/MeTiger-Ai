/**
 * Настройка «род агента» (Этап: род + состояние собеседника).
 *
 * Проверяются настоящие функции: движковый слой — импортом engine/gender.js и
 * врезкой в createEngine, фронтовый — трансляцией src/lib/gender.ts через esbuild
 * (тот же приём, что в test/front.test.js). Пересказов логики в тесте нет.
 *
 * Отдельная забота — чтобы из дефолтного поведения исчезла донорская директива
 * «ты мужчина, и это не обсуждается» и тон сверху вниз: проектом пользуются
 * не только владелец.
 *
 *   node test/gender.test.js
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as gender from '../engine/gender.js';
import { createEngine } from '../engine/chat.js';
import { onRequestPost } from '../functions/api/chat.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

const ENV = { GROQ_KEYS: 'g1' };
function fakeFetch(reply) {
  const calls = [];
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    return {
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] }),
    };
  };
  impl.calls = calls;
  return impl;
}
const sysOf = (f) => (f.calls[0] ? f.calls[0].body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') : '');

console.log('G — разбор значения настройки');
{
  const male = ['м', 'муж', 'мужской', 'он', 'M', 'male', 'MALE', ' male '];
  const female = ['ж', 'жен', 'женский', 'она', 'f', 'female', 'ЖЕНСКИЙ'];
  ok('G1: русские и английские написания рода сворачиваются в male/female',
    male.every((v) => gender.normalize(v) === 'male') && female.every((v) => gender.normalize(v) === 'female'),
    male.concat(female).filter((v) => gender.normalize(v) !== (male.indexOf(v) >= 0 ? 'male' : 'female')).join(','));

  const junk = ['', 'авто', 'auto', 'x', 'фигня', null, undefined, 42, {}, [], true];
  ok('G2: всё непонятное = auto, падения нет', junk.every((v) => gender.normalize(v) === 'auto'));

  ok('G3: GENDERS ровно три значения — ровно столько кнопок в меню',
    JSON.stringify(gender.GENDERS) === JSON.stringify(['auto', 'male', 'female']), JSON.stringify(gender.GENDERS));

  ok('G4: pick различает «я выбрал авто» и «тут мусор»',
    gender.pick('авто') === 'auto' && gender.pick('auto') === 'auto'
      && gender.pick('чушь') === '' && gender.pick('') === '' && gender.pick('м') === 'male',
    [gender.pick('авто'), gender.pick('чушь')].join('|'));

  ok('G5: GENDER_CHOICES — три варианта с подсказкой для каждого',
    gender.GENDER_CHOICES.length === 3
      && gender.GENDER_CHOICES.every((c) => gender.GENDERS.indexOf(c.value) >= 0 && c.title && c.hint),
    JSON.stringify(gender.GENDER_CHOICES));
}

console.log('R — что из этого попадает в подсказку модели');
{
  const m = gender.block('male'), f = gender.block('female'), a = gender.block('auto');
  ok('R1: мужской режим даёт окончания и только окончания',
    m.includes('я рад') && m.includes('я готов') && !m.includes('рада') && m.includes('ничего больше'), m.slice(0, 120));
  ok('R2: женский режим симметричен', f.includes('я рада') && f.includes('я готова') && !f.includes('«я рад»,'), f.slice(0, 120));
  ok('R3: в auto нет ни тех, ни других окончаний — только строка об обращении',
    !a.includes('я рад') && !a.includes('я рада') && a.length < m.length, a.slice(0, 120));

  ok('R4: тон сверху вниз отрезан во всех трёх режимах',
    [a, m, f].every((b) => b.includes('без превосходства') && b.includes('без поучений')
      && b.includes('повелительных форм') && b.includes('сюсюканья')), 'не хватает оговорки');
  ok('R5: ни «навсегда», ни «не обсуждается», ни «мальчик мой» как обращение',
    [a, m, f].every((b) => !b.includes('не обсуждается') && !b.includes('навсегда')));
  ok('R6: латинских огрызков в тексте нет (была опечатка «form»)',
    [a, m, f].every((b) => (b.match(/[A-Za-zа-я]{2,}/g) || []).filter((w) => /^[A-Za-z]{3,}$/.test(w)).length === 0),
    JSON.stringify((a.match(/[A-Za-z]{3,}/g) || [])));
}

console.log('E — приоритеты: человек > развертывание');
{
  ok('E1: выбор из запроса перебивает env',
    gender.resolve({ gender: 'Ж' }, { AGENT_GENDER: 'male' }) === 'female');
  ok('E2: без запроса работает env (и по-русски тоже)',
    gender.resolve({}, { AGENT_GENDER: 'м' }) === 'male' && gender.resolve(null, {}) === 'auto');
  ok('E3: мусор в запросе не затирает настройку развертывания',
    gender.resolve({ gender: 'чушь' }, { AGENT_GENDER: 'male' }) === 'male');
  ok('E4: явное «авто» человека — тоже выбор, оно не отыгрывает env назад',
    gender.resolve({ gender: 'авто' }, { AGENT_GENDER: 'male' }) === 'auto');
  ok('E5: blockFor = block(resolve(...)) — движок и диагностика не разъедутся',
    gender.blockFor({ gender: 'ж' }, {}) === gender.block('female'));
  ok('E6: cfgOf читает AGENT_GENDER',
    gender.cfgOf({ AGENT_GENDER: 'женский' }).gender === 'female' && gender.cfgOf({}).gender === 'auto');
  ok('E7: label — по-человечески',
    gender.label('male') === 'мужской' && gender.label('ж') === 'женский' && gender.label('чушь') === 'авто');
}

console.log('C — дорога настройки сквозь createEngine');
{
  const f1 = fakeFetch('ок');
  await createEngine({ env: ENV, fetch: f1, sleep: async () => {} }).run({ text: 'привет', gender: 'ж' });
  const s1 = sysOf(f1);
  ok('C1: поле gender из запроса доезжает до system (критерий «доезжает до движка»)',
    s1.includes('Род агента — женский') && s1.includes('я рада'), s1.slice(-380));

  const f2 = fakeFetch('ок');
  const r2 = await createEngine({ env: ENV, fetch: f2, sleep: async () => {} }).run({ text: 'привет', gender: 'м' });
  ok('C2: мужской режим — окончания в подсказке, а не в ответе',
    sysOf(f2).includes('Род агента — мужской') && !sysOf(f2).includes('я рада'), sysOf(f2).slice(-380));
  ok('C3: эффективный род возвращается метаданными ответа', r2.gender === 'male', String(r2.gender));

  const f3 = fakeFetch('ок');
  const r3 = await createEngine({ env: ENV, fetch: f3, sleep: async () => {} }).run({ text: 'привет' });
  ok('C4: без настройки в system нет ни мужских, ни женских окончаний — только строка об обращении',
    !sysOf(f3).includes('Род агента — ') && sysOf(f3).includes('К человеку — ровным тоном'), sysOf(f3).slice(-300));
  ok('C5: и в метаданных тогда auto', r3.gender === 'auto', String(r3.gender));

  const f4 = fakeFetch('ок');
  await createEngine({ env: Object.assign({}, ENV, { AGENT_GENDER: 'ж' }), fetch: f4, sleep: async () => {} }).run({ text: 'привет' });
  ok('C6: env-путь работает так же (для бота и для развертывания целиком)',
    sysOf(f4).includes('Род агента — женский'), sysOf(f4).slice(-300));

  const f5 = fakeFetch('ок');
  await createEngine({ env: ENV, fetch: f5, sleep: async () => {} }).run({ text: 'привет', gender: 'ж', system: 'Ты — редактор.' });
  ok('C7: чужая персона не получает нашей настройки рода (пользовательский system — территория человека)',
    !sysOf(f5).includes('Род агента'), sysOf(f5).slice(0, 200));
}

console.log('S — гигиена файла');
{
  const src = readFileSync(join(process.cwd(), 'engine', 'gender.js'), 'utf8');
  ok('S1: жёстких путей наружу в движке нет',
    !src.includes('/home/') && !src.includes('uploads') && !src.includes('yama'), 'встретился путь донора');
  ok('S2: ни одного «.» в относительном импорте за пределы engine',
    !src.includes('../'), src.match(/\.\./g) ? 'import вне engine/' : '');
}

console.log('F — то же во фронте (src/lib/gender.ts через esbuild)');
{
  const bin = join(process.cwd(), 'node_modules', '.bin', 'esbuild');
  if (!existsSync(bin)) {
    /* молча проглотить семь проверок фронта — тот же грех, что зелёный npm test без
       node_modules: пропущенное считается провалом, пока его не починили */
    fail++;
    console.log('  ✖ фронтовые проверки не выполнены: esbuild не найден (' + bin + '), нужен `npm install`');
  } else {
    const dir = join(process.cwd(), 'node_modules', '.cache', 'metiger-front');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const out = join(dir, 'gender.mjs');
    execFileSync(bin, ['src/lib/gender.ts', '--format=esm', '--outfile=' + out, '--loader:.ts=ts', '--log-level=error'], { stdio: 'inherit' });
    const front = await import(out);

    const store = (() => {
      const map = new Map();
      return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        map,
      };
    })();

    ok('F1: значения front и engine совпадают буква в букву',
      JSON.stringify(front.GENDER_CHOICES.map((c) => c.value)) === JSON.stringify(gender.GENDERS),
      JSON.stringify(front.GENDER_CHOICES.map((c) => c.value)));
    ok('F2: подсказки во фронте и в движке одинаковые — меню не врёт про поведение',
      front.GENDER_CHOICES.every((c) => {
        const eng = gender.GENDER_CHOICES.find((e) => e.value === c.value);
        return eng && eng.hint === c.hint && eng.title === c.title;
      }));
    ok('F3: чистое хранилище читается как auto', front.readGender(store) === 'auto');
    front.writeGender('female', store);
    ok('F4: запись и чтение смыкаются по одному ключу',
      front.readGender(store) === 'female' && store.map.get('mt-gender') === JSON.stringify('female'),
      String(store.map.get('mt-gender')));
    store.map.set('mt-gender', 'не json');
    ok('F5: битое хранилище = auto, а не исключение в момент отправки', front.readGender(store) === 'auto');
    store.map.set('mt-gender', JSON.stringify('male'));
    ok('F6: валидатор принимает только три значения',
      front.isGender('male') && front.isGender('auto') && !front.isGender('чушь') && !front.isGender(42) && !front.isGender(null));
    ok('F7: auto в запрос не отправляется — дефолт развертывания не перебивается молча',
      front.genderForRequest('auto') === undefined && front.genderForRequest('male') === 'male');
  }
}

console.log('P — граница HTTP: /api/chat принимает настройку');
{
  const req = (o) => new Request('http://x/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
  const g = fakeFetch('Нормальный ответ агента');
  const saved = globalThis.fetch;
  globalThis.fetch = g;
  const call = async (body, env) => {
    const before = g.calls.length;
    const res = await onRequestPost({ request: req(Object.assign({ rate: 0 }, body)), env: env || ENV });
    const json = await res.json();
    return { res, json, body: g.calls[before] ? g.calls[before].body : null };
  };

  const a = await call({ text: 'привет', gender: 'ж' });
  const sysA = a.body ? a.body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') : '';
  ok('P1: поле gender из тела запроса доезжает до подсказки модели (сквозной путь настройки)',
    a.res.status === 200 && sysA.includes('Род агента — женский') && sysA.includes('я рада'), sysA.slice(-260));
  ok('P2: ответ говорит, каким родом он реально отвечал', a.json.gender === 'female', String(a.json.gender));

  const b = await call({ text: 'привет' }, Object.assign({}, ENV, { AGENT_GENDER: 'м' }));
  const sysB = b.body ? b.body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') : '';
  ok('P3: env-путь работает на той же границе (для бота и для развертывания)',
    sysB.includes('Род агента — мужской'), sysB.slice(-200));

  const c = await call({ text: 'привет', gender: 'фигня' }, Object.assign({}, ENV, { AGENT_GENDER: 'м' }));
  const sysC = c.body ? c.body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n') : '';
  ok('P4: чужая чушь в поле не перекраивает настройку развертывания',
    sysC.includes('Род агента — мужской') && c.json.gender === 'male', c.json.gender);

  const d2 = await call({ text: 'опять не работает, сколько раз можно', gender: 'ж' }, Object.assign({}, ENV, { EMOTION_LABEL: '1' }));
  ok('P5: состояние собеседника идёт тем же ходом и возвращается вместе с родом',
    d2.json.gender === 'female' && d2.json.emotion && d2.json.emotion.id === 'irritation', JSON.stringify(d2.json.emotion));

  globalThis.fetch = saved;
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
