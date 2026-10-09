/**
 * Судья глубины (0.123) — «размышлять глубже» решает агент, а не переключатель.
 *
 * Сети нет: слой читает только текст вопроса, интент классификатора и переменные
 * развертывания, поэтому каждая проверка — это вход и ожидаемый вердикт словами.
 * Отдельно сторожим то, что видно человеку: причина обязана читаться (никаких id
 * правил и имён переменных в подписи ответа) и обязана быть на месте, когда глубина
 * поднята, — иначе режим выглядит сломанным ровно так же, как косметическая кнопка.
 *
 * Запуск: node test/depth.test.js
 */
import { cfgOf, DEPTH_THRESHOLD, judge, lineOf, LONG_CHARS, RULES, VETO } from '../engine/depth.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

console.log('Г — судья глубины: решение принимает агент, и оно объяснено словами');

const j = (text, extra) => judge(Object.assign({ text }, extra || {}));

/* ── приметы, которые поднимают глубину ── */
{
  const proof = j('докажи, что корень из 2 иррациональное число');
  ok('Г1: доказательство — глубже, и причина названа словами',
    proof.deep === true && /доказательство/.test(proof.why) && proof.source === 'агент',
    JSON.stringify({ deep: proof.deep, why: proof.why }));

  const plan = j('Составь план переезда сайта на новый хостинг по шагам, чтобы ничего не упало');
  ok('Г2: план по шагам — глубже', plan.deep === true && /план/.test(plan.why), plan.why);

  const stakes = j('Что проверить в договоре аренды перед подписанием, чтобы не потерять залог');
  ok('Г3: дорогая цена ошибки (договор) — глубже',
    stakes.deep === true && /цена ошибки/.test(stakes.why), stakes.why);

  const ask = j('Не спеши и разберись подробно, почему этот подход считается неправильным');
  ok('Г4: человек попросил подумать — глубже (и это не переключатель, а слова в вопросе)',
    ask.deep === true && /попросил подумать/.test(ask.why), ask.why);

  const bug = j('Почему не работает сборка: exception в консоли, traceback обрывается на импорте');
  ok('Г5: разбор неполадки — глубже', bug.deep === true && /неполадк/.test(bug.why), bug.why);

  const arch = j('Спроектируй архитектуру сервиса, который должен масштабироваться на миллион пользователей');
  ok('Г6: проектное решение — глубже', arch.deep === true && /проектное/.test(arch.why), arch.why);

  /* Половина очка сама по себе ничего не решает — это и есть смысл порога:
     «сравни» без «объясни» остаётся быстрым ответом. */
  const pair = j('Сравни SQLite и Postgres и объясни, в чём разница для мобильного приложения');
  ok('Г7: две приметы по половинке очка (сравнение + объяснение) вместе дают глубину',
    pair.deep === true && pair.score >= DEPTH_THRESHOLD && /сравнение/.test(pair.why) && /объяснить/.test(pair.why)
      && j('Сравни SQLite и Postgres').deep === false,
    JSON.stringify({ score: pair.score, why: pair.why, один: j('Сравни SQLite и Postgres').why }));

  const long = j('Опиши, как устроен процесс: ' + 'шаг за шагом система принимает запрос, проверяет его и отдаёт ответ. '.repeat(6));
  ok('Г8: длина вопроса — примета (очко), а не приговор: сама по себе глубину не поднимает',
    long.score >= 1 && long.hits.indexOf('long') >= 0
      && j('расскажи про космос').deep === false,
    JSON.stringify({ score: long.score, hits: long.hits }));
}

/* ── где глубина вредна или не нужна ── */
{
  ok('Г9: приветствие — не глубже (глубина на болтовне это усреднение голоса)',
    j('привет').deep === false && j('спасибо').deep === false && j('ок').deep === false,
    JSON.stringify(['привет', 'спасибо', 'ок'].map((t) => j(t).why)));

  const creative = j('придумай подпись к фото с котом');
  ok('Г10: творчество — не глубже, и причина объясняет отказ',
    creative.deep === false && /творческ/.test(creative.why) && creative.veto === 'creative',
    JSON.stringify(creative));

  ok('Г11: код, математика и зрение не поднимаются — у них свои головы и smart-очередь',
    j('напиши функцию на python', { intent: 'code' }).deep === false
      && j('сколько будет 17*23', { intent: 'math' }).deep === false
      && j('что на картинке', { intent: 'vision', images: ['data:image/png;base64,AA'] }).deep === false,
    JSON.stringify(['code', 'math', 'vision'].map((i) => j('вопрос', { intent: i }).why)));

  ok('Г12: картинка без интента — тоже не глубже: её решает совет зрячих',
    j('сколько машин на фото', { images: ['data:image/png;base64,AA'] }).deep === false
      && /зряч/.test(j('сколько машин на фото', { images: ['x'] }).why),
    j('сколько машин на фото', { images: ['x'] }).why);

  ok('Г13: доказательство с картинкой не поднимает глубину — зрение важнее марки модели',
    j('докажи по схеме, что угол прямой', { images: ['x'] }).deep === false);
}

/* ── кто главнее: человек, судья, переменные ── */
{
  ok('Г14: явная просьба извне (curl, другой клиент) важнее правил судьи',
    j('привет', { asked: true }).deep === true && j('привет', { asked: true }).source === 'человек',
    JSON.stringify(j('привет', { asked: true })));

  ok('Г15: DEPTH=off — судья молчит, глубина не поднимается даже на доказательстве',
    j('докажи теорему', { env: { DEPTH: 'off' } }).deep === false
      && /выключен/.test(j('докажи теорему', { env: { DEPTH: 'off' } }).why)
      && j('докажи теорему', { env: { DEPTH: '0' } }).deep === false);

  ok('Г16: DEPTH=always — глубина на всём, кроме того, где она запрещена (картинка)',
    j('привет', { env: { DEPTH: 'always' } }).deep === true
      && j('что на фото', { env: { DEPTH: 'always' }, images: ['x'] }).deep === false);

  const пара = 'Сравни SQLite и Postgres и объясни, в чём разница';
  const много = 'Не спеши, обоснуй каждый шаг и докажи, что это решение верное';
  ok('Г17: DEPTH_MIN поднимает порог — пара примет в пол-очка больше не решает, а четыре очка решают',
    j(пара, { env: { DEPTH_MIN: 4 } }).deep === false
      && j(пара).deep === true
      && j(много, { env: { DEPTH_MIN: 4 } }).deep === true
      && j(много, { env: { DEPTH_MIN: 6 } }).deep === false,
    JSON.stringify({ при4: j(пара, { env: { DEPTH_MIN: 4 } }).score, много: j(много).score }));

  ok('Г18: DEPTH_COUNCIL_K советует больше голов на дорогой задаче и не трогает k на обычной',
    j('докажи теорему и обоснуй каждый шаг', { env: { DEPTH_COUNCIL_K: 4 } }).councilK === 4
      && j('привет', { env: { DEPTH_COUNCIL_K: 4 } }).councilK === 0
      && cfgOf({ DEPTH_COUNCIL_K: 99 }).councilK === 5
      && cfgOf({}).councilK === 0,
    JSON.stringify(cfgOf({ DEPTH_COUNCIL_K: 99 })));
}

/* ── что видит человек ── */
{
  const v = j('докажи, что корень из 2 иррациональное число');
  ok('Г19: причина читается человеком: ни id правил, ни имён переменных, ни очков',
    !/proof|plan|stakes|debug|arch|compare|multi|teach/.test(v.why)
      && !/DEPTH|THRESHOLD|COUNCIL/.test(v.why) && !/очк/.test(v.why)
      && v.why.length > 8 && v.why.length < 90,
    v.why);

  ok('Г20: подпись под ответом — только когда глубина поднята, и начинается с «· глубже»',
    lineOf(v).indexOf(' · глубже: ') === 0 && lineOf(j('привет')) === '' && lineOf(null) === ''
      && lineOf({ deep: true }) === ' · глубже',
    JSON.stringify([lineOf(v), lineOf(j('привет'))]));

  ok('Г21: в отказе причина тоже названа словами — молчание выглядит поломкой',
    /не глубже:/.test(j('придумай подпись к фото с котом').why)
      && /не глубже:/.test(j('напиши функцию', { intent: 'code' }).why)
      && /не глубже:|примет глубины нет/.test(j('расскажи про космос').why),
    JSON.stringify([j('придумай подпись').why, j('расскажи про космос').why]));

  /* Очко за «вопросы списком» добирается только к порогу: без него длинный список
     вопросов стал бы глубоким сам по себе, а с двумя вопросами и без примет — нет. */
  ok('Г22: несколько вопросов подряд добирают очко только когда его не хватает до порога',
    j('Объясни, как работает этот механизм? И почему так происходит?').deep === true
      && j('Объясни, как работает этот механизм.').deep === false
      && j('привет? как дела?').deep === false,
    JSON.stringify([j('Объясни, как работает этот механизм? И почему так происходит?').hits,
      j('Объясни, как работает этот механизм.').score]));
}

/* ── слой не имеет права упасть ── */
{
  const мусор = [undefined, null, '', '   ', 123, {}, [], 'докажи'];
  ok('Г23: мусор на входе не роняет судью и не поднимает глубину',
    мусор.every((x) => {
      try { const r = judge(x); return r && typeof r.deep === 'boolean' && r.why.length > 0; }
      catch (e) { return false; }
    }) && judge().deep === false && judge('').deep === false && judge(123).deep === false
      /* строка-вход понимается как вопрос: «докажи» — это примета, а не пустота */
      && judge('докажи').deep === true,
    JSON.stringify([judge(123).why, judge('докажи').why]));

  ok('Г24: правила и запреты — данные слоя, их видно целиком (нельзя потерять примету молча)',
    Array.isArray(RULES) && RULES.length >= 8 && RULES.every((r) => r.id && r.weight > 0 && r.why && r.re instanceof RegExp)
      && Array.isArray(VETO) && VETO.length >= 2
      && DEPTH_THRESHOLD === 2 && LONG_CHARS > 100);

  ok('Г25: решение устойчиво — один и тот же вопрос дважды даёт один вердикт',
    JSON.stringify(j('докажи, что корень из 2 иррационален')) === JSON.stringify(j('докажи, что корень из 2 иррационален'))
      && JSON.stringify(j('привет')) === JSON.stringify(j('привет')));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
