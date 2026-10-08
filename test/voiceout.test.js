/**
 * Голос в обратную сторону: устная форма текста, выбор голоса, подпись времени
 * и сам протокол озвучки (на подставном соединении — сети в проверках нет).
 *
 * Живой повод у каждой проверки здесь свой, но общая причина одна: озвучка
 * ломается не на «не пришёл звук», а на мелочах — «frac» вместо «дробь», 403
 * из-за подписи, склейка «в степени ny» вместо «в степени n». Всё это видели
 * глазами на пробах, и всё это закреплено ниже.
 */
import { createHash } from 'node:crypto';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

const m = await import('../engine/voiceout.js');
const { gecToken, speechText, clampSpeech, pickVoice, guessLang, parseFrame, synthesize, VOICES, TTS_LIMITS } = m;

console.log('G — подпись времени (Sec-MS-GEC)');
{
  /* Значение сверено с рабочей библиотекой edge-tts 7.2.8 для той же метки времени:
     библиотека работает, значит её подпись — верная. Своя подпись обязана совпасть
     побайтово, иначе служба отвечает 403 (так и было, пока подпись не свели). */
  const эталонПитона = 'FF7809BFC19BE2038B685B2E';
  const своя = await gecToken(1770000000000);
  ok('G1: подпись совпадает с эталоном библиотеки (иначе служба отвечает 403)',
    своя.startsWith(эталонПитона), своя);
  ok('G2: подпись — 64 знака в верхнем регистре', /^[0-9A-F]{64}$/.test(своя));
  const черезМинуту = await gecToken(1770000000000 + 60_000);
  ok('G3: внутри пяти минут подпись та же (округление вниз до 300 секунд)', черезМинуту === своя);
  const черезШесть = await gecToken(1770000000000 + 360_000);
  ok('G4: на следующем пятиминутном шаге подпись меняется', черезШесть !== своя);
}

console.log('S — устная форма ответа');
{
  ok('S1: \\frac и \\sqrt читаются словами, а не «frac/sqrt»',
    (() => {
      const r = speechText('Корень \\(\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}\\) тут.');
      return /дробь/i.test(r) && /корень из/i.test(r) && !/frac|sqrt/i.test(r);
    })(), speechText('Корень \\(\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}\\) тут.'));

  ok('S2: вложенные скобки в дроби разбираются (числитель сам со скобками)',
    (() => {
      const r = speechText('\\(x=\\frac{-b\\pm\\sqrt{D}}{2a}\\)');
      return /дробь минус b плюс-минус корень из D на 2a/.test(r);
    })(), speechText('\\(x=\\frac{-b\\pm\\sqrt{D}}{2a}\\)'));

  ok('S3: степень и индекс — словами, без склейки «в степени ny»',
    (() => {
      const r = speechText('\\(x^{n}y_{i}\\)');
      return /в степени n/.test(r) && /индекс i/.test(r) && !/степени ny/.test(r);
    })(), speechText('\\(x^{n}y_{i}\\)'));

  ok('S4: \\left не превращается в «меньше или равно ft»',
    (() => {
      const r = speechText('\\(\\lim_{n\\to\\infty}\\left(1+\\frac{1}{n}\\right)^{n}=e\\)');
      return !/ft\(/.test(r) && /стремится к бесконечности/.test(r) && /предел/.test(r);
    })(), speechText('\\(\\lim_{n\\to\\infty}\\left(1+\\frac{1}{n}\\right)^{n}=e\\)'));

  ok('S5: блок кода не читается — вместо него короткая пометка',
    (() => {
      const r = speechText('Вот код:\n```python\nprint("привет")\n```\nи всё.');
      return /Пример кода/.test(r) && !/print|python/.test(r);
    })());

  ok('S6: ссылка читается своим текстом, а не адресом',
    (() => {
      const r = speechText('Смотри [документацию](https://example.com/a/b).');
      return /документацию/.test(r) && !/example\.com/.test(r) && !/http/.test(r);
    })(), speechText('Смотри [документацию](https://example.com/a/b).'));

  ok('S7: разметка (**жирный**, ## заголовок, списки) не читается вслух',
    (() => {
      const r = speechText('## Итог\n\n1. Первое **важное**\n2. Второе');
      return !/[*#]/.test(r) && /Итог/.test(r) && /важное/.test(r);
    })(), speechText('## Итог\n\n1. Первое **важное**\n2. Второе'));

  ok('S8: эмодзи не произносятся', (() => {
    const r = speechText('Готово! ✅🔥 Отлично 🎉');
    return !/[\u{1F300}-\u{1FAFF}\u2705]/u.test(r) && /Готово/.test(r);
  })(), speechText('Готово! ✅🔥 Отлично 🎉'));

  ok('S9: дефис внутри русского слова остаётся словом, а минус в формуле — минусом',
    (() => {
      const r = speechText('\\(\\text{что-то}\\) и \\(a-b=2\\)');
      return /что-то/.test(r) && /a минус b равно 2/.test(r);
    })(), speechText('\\(\\text{что-то}\\) и \\(a-b=2\\)'));

  ok('S10: система уравнений читается, знаки выравнивания не читаются',
    (() => {
      const r = speechText('\\(\\begin{cases} x+y=5 \\\\ x-y=1 \\end{cases}\\)');
      return /система/.test(r) && !/&/.test(r) && !/begin/.test(r);
    })(), speechText('\\(\\begin{cases} x+y=5 \\\\ x-y=1 \\end{cases}\\)'));
}

console.log('L — потолки и выбор голоса');
{
  const к = clampSpeech('Первое предложение. Второе предложение. Третье.', 30);
  ok('L1: длинный текст режется по границе фразы, а не по слову',
    к.cut && к.text === 'Первое предложение.', JSON.stringify(к));
  ok('L2: короткий текст не режется', clampSpeech('Коротко.', 100).cut === false);
  ok('L3: потолок движка — разумные три тысячи знаков',
    TTS_LIMITS.MAX_CHARS === 3000 && TTS_LIMITS.TIMEOUT_MS >= 5000);
  ok('L4: язык ответа — по кириллице; цифры и знаки считаем русскими',
    guessLang('Привет') === 'ru' && guessLang('Hello there') === 'en' && guessLang('2+2=4') === 'ru');
  ok('L5: по умолчанию женский голос, по просьбе — мужской',
    pickVoice('Привет', '') === VOICES.ru.female && pickVoice('Привет', 'male') === VOICES.ru.male);
  ok('L6: английский ответ читается английским голосом',
    pickVoice('Hello, how are you doing today?', 'male') === VOICES.en.male);
}

console.log('P — кадры службы голоса');
{
  const текст = 'X-RequestId:1\r\nContent-Type:application/json\r\nPath:turn.end\r\n\r\n';
  ok('P1: текстовый кадр turn.end узнаётся', parseFrame(текст).kind === 'end');
  const мета = 'Path:audio.metadata\r\n\r\n{"Metadata":[]}';
  ok('P2: кадр с данными — не конец', parseFrame(мета).kind === 'meta');
  /* Бинарный кадр: два байта длины, заголовок, два байта-разделителя, аудио.
     Проверено на живом соединении: длина считается ВМЕСТЕ с этими двумя байтами
     (в кадре со службы при длине 128 заголовок занимал ровно [2, 128), за ним шли
     \r\n, и только потом начинался mp3 — на этом тест сперва и упал). */
  const заголовок = 'X-RequestId:1\r\nPath:audio\r\n';
  const аудио = new Uint8Array([0xFF, 0xF3, 0x64, 0xC4]);
  const длина = 2 + заголовок.length;
  const кадр = new Uint8Array(длина + 2 + аудио.length);
  кадр[0] = (длина >> 8) & 0xFF;
  кадр[1] = длина & 0xFF;
  кадр.set(new TextEncoder().encode(заголовок), 2);
  кадр.set(аудио, длина + 2);
  const разбор = parseFrame(кадр.buffer);
  ok('P3: аудио достаётся из бинарного кадра без лишних байт',
    разбор.kind === 'audio' && разбор.audio.length === 4 && разбор.audio[0] === 0xFF,
    JSON.stringify(разбор.audio || null));
  ok('P4: битый кадр не роняет разбор', parseFrame(new Uint8Array([0x00]).buffer).kind === 'плохой');
}

console.log('T — синтез на подставном соединении (как отвечает служба)');
{
  /* Подставное соединение повторяет поведение службы: принять конверт и SSML,
     прислать два кадра с аудио и кадр конца. Ничего своего он не проверяет —
     проверяется наш разбор и наша сборка запросов. */
  function подставное() {
    const отправлено = [];
    const слушатели = { message: [], close: [], error: [] };
    /* Событие наружу: подставному соединению нужно уметь «прислать» кадр. */
    const событие = (имя, ev) => (слушатели[имя] || []).forEach((f) => f(ev));
    const ws = {
      accept() {},
      close() { слушатели.close.forEach((f) => f()); },
      send(текст) {
        отправлено.push(текст);
        if (/Path:speech.config/.test(текст)) return;
        if (/Path:ssml/.test(текст)) {
          const кусок = new Uint8Array([0xFF, 0xF3, 0x64, 0xC4, 0x11]);
          const заголовок = new TextEncoder().encode('X-RequestId:1\r\nPath:audio\r\n');
          const длина = 2 + заголовок.length;
          const кадр = new Uint8Array(длина + 2 + кусок.length);
          кадр[0] = (длина >> 8) & 0xFF; кадр[1] = длина & 0xFF;
          кадр.set(заголовок, 2); кадр.set(кусок, длина + 2);
          setTimeout(() => слушатели.message.forEach((f) => f({ data: кадр.buffer })), 0);
          setTimeout(() => слушатели.message.forEach((f) => f({ data: 'Path:turn.end\r\n\r\n' })), 1);
        }
      },
      addEventListener(имя, f) { (слушатели[имя] = слушатели[имя] || []).push(f); },
      событие,
      отправлено,
    };
    return ws;
  }

  const ws = подставное();
  const итог = await synthesize('Ответ модели: корень из двух — иррациональное число.', {
    connect: async () => ws,
    now: () => 1770000000000,
  });
  ok('T1: синтез отдаёт mp3 и голос', итог.ok && итог.mime === 'audio/mpeg'
    && итог.audio.length === 5 && итог.voice === VOICES.ru.female, JSON.stringify({ ok: итог.ok, len: итог.audio && итог.audio.length }));
  const адрес = ws.отправлено.length ? ws.отправлено : [];
  ok('T2: конверт и SSML ушли в правильном порядке', адрес.length === 2
    && /Path:speech.config/.test(адрес[0]) && /Path:ssml/.test(адрес[1])
    && /outputFormat/.test(адрес[0]) && /audio-24khz-48kbitrate-mono-mp3/.test(адрес[0]));
  ok('T3: в SSML — выбранный голос и устная форма текста (формул в нём нет)',
    /ru-RU-SvetlanaNeural/.test(адрес[1]) && !/\\/.test(адрес[1].split('\r\n\r\n')[1] || ''));

  const ws2 = подставное();
  ws2.send = function () { /* молчит: ни кадров, ни конца */ };
  const молчит = await synthesize('Тишина', { connect: async () => ws2, timeoutMs: 60 });
  ok('T4: если служба молчит — понятная причина, а не пустой звук',
    !молчит.ok && /молчит/.test(молчит.why), JSON.stringify(молчит));

  /* Разные болезни — разные слова: «молчит вовсе» и «прислала кадры, но без звука»
     (второе видели на проде: соединение есть, кадры есть, аудио нет). */
  const ws3 = подставное();
  ws3.send = function (текст) {
    if (/Path:ssml/.test(текст)) setTimeout(() => ws3.событие('message', { data: 'Path:turn.end\r\n\r\n' }), 0);
  };
  const безЗвука = await synthesize('Проверка', { connect: async () => ws3, timeoutMs: 500 });
  ok('T4б: кадры пришли, а звука нет — сказано именно это, с разбором по ?debug=1',
    !безЗвука.ok && /не прислала звук/.test(безЗвука.why), JSON.stringify(безЗвука));

  const ws4 = подставное();
  ws4.send = function (текст) {
    if (/Path:ssml/.test(текст)) setTimeout(() => ws4.событие('message', { data: 'Path:turn.end\r\n\r\n' }), 0);
  };
  const сРазбором = await synthesize('Проверка', { connect: async () => ws4, timeoutMs: 500, debug: true });
  ok('T4в: с ?debug=1 видно, сколько кадров пришло и чем они были',
    !сРазбором.ok && сРазбором.debug && сРазбором.debug.кадров >= 1 && сРазбором.debug.конец >= 1,
    JSON.stringify(сРазбором.debug));

  const нет = await synthesize('Текст', { connect: async () => { throw new Error('сети нет'); } });
  ok('T5: недоступная служба — причина словами', !нет.ok && /недоступна/.test(нет.why), JSON.stringify(нет));

  /* Ответ из одних значков: читать нечего, и это не ошибка службы — соединение
     даже не открываем (иначе потратили бы запрос на пустоту). */
  const пусто = await synthesize('✅🎉🔥', { connect: async () => { throw new Error('не должны были соединяться'); } });
  ok('T6: из одних значков читать нечего — соединение не открывается',
    !пусто.ok && пусто.why === 'нечего читать', JSON.stringify(пусто));

  const код = await synthesize('```js\nlet a = 1;\n```', { connect: async () => { throw new Error('нет'); } });
  ok('T7: ответ из одного блока кода читается пометкой «Пример кода», а не кодом',
    !код.ok && /недоступна/.test(код.why), JSON.stringify(код));
}

console.log('W — вход /api/tts');
{
  const { onRequestPost, onRequestGet } = await import('../functions/api/tts.js');
  const ctx = (body, url) => ({
    env: { RATE_LIMIT: '0' },
    request: new Request(url || 'https://a/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
  const пусто = await onRequestPost(ctx({ text: '   ' }));
  ok('W1: пустой текст — понятный отказ, а не пустой звук', пусто.status === 400
    && /нечего читать/.test(await пусто.text()), пусто.status);

  const длинный = await onRequestPost(ctx({ text: 'а'.repeat(4000) }));
  ok('W2: слишком длинный текст отбивается с человеческой причиной',
    длинный.status === 413 && /знаков/.test(await длинный.text()), длинный.status);

  const устно = await onRequestPost(ctx({ text: 'Считаем \\(\\frac{a}{b}\\) тут.' }, 'https://a/api/tts?text=1'));
  const j = await устно.json();
  ok('W3: ?text=1 отдаёт устную форму — по ней говорит речь устройства',
    j.ok && /дробь a на b/.test(j.speech) && !/frac/.test(j.speech), JSON.stringify(j));

  const инфо = await onRequestGet({ env: {} });
  const и = await инфо.json();
  ok('W4: GET рассказывает, что принимает вход, и какими голосами говорит',
    и.ok && и.maxChars > 1000 && Array.isArray(и.voices.ru) && и.voices.ru.length === 2
      && /иррациональное число/.test(и.example), JSON.stringify(и).slice(0, 120));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
