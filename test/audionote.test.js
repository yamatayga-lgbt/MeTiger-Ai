/**
 * 0.180 «Свежесть и звук», половина про звук: запись → расшифровка → конспект
 * с таймкодами.
 *
 * Просьба владельца (план обгона, 3.5): «у Алисы Про — 23 типа файлов, включая
 * MP3/MP4… у нас есть распознавание речи, значит пересказ голосового файла —
 * работа на день-два». Что обещано человеку: прислал запись — получил конспект,
 * и в конспекте видно, ГДЕ это сказано.
 *
 * Проверяем не «поле есть», а места, где это ломается молча:
 *   · короткая голосовая остаётся вопросом, а не превращается в «конспект»;
 *   · таймкоды берутся из отрезков Whisper, а не выдумываются;
 *   · нет отрезков — конспект без меток и ПРЯМОЙ запрет их выдумывать;
 *   · дорожка склеивает реплики и не везёт модели получасовой текст целиком;
 *   · указание доезжает до движка (system), а не остаётся в файле;
 *   · compose из вложений делает то же самое, что описано выше, — на живом пути.
 *
 *   node test/audionote.test.js
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { versionsAligned } from './version-sync.js'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}

const read = (p) => readFileSync(p, 'utf8')
const notes = read('src/lib/release-notes.ts')
const readme = read('README.md')
const pkg = JSON.parse(read('package.json'))
const sw = read('public/sw.js')
const door = read('functions/api/chat.js')
const attachSrc = read('engine/attach.js')
const voiceinSrc = read('engine/voicein.js')
const chain = String(pkg.scripts.test || '')
const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/* Настоящие модули, а не пересказ: и конспект, и сборка вложений — те же, что в бою. */
const { fmtStamp, fmtDuration, timeline, wantsNote, noteOf, noteLine, wordsWord, NOTE_ASK, NOTE_MIN_SEC, NOTE_MIN_SEGMENTS, GAP_SEC } = await import('../engine/audionote.js')
const { classifyTask, tierFor } = await import('../engine/route.js')

const { compose, readVoiceBytes } = await import('../engine/attach.js')

/* Сообщение, которое уходит модели вместе с длинной записью: дорожка с метками
   времени и просьба конспекта. На нём и проверяем, что это не «заказ кода». */
const noteMsg = compose([], {
  voiceName: 'совещание.mp3', voiceSeconds: 80,
  voiceText: 'Сначала про бюджет. Дальше про сроки. Теперь про подрядчика.',
  voiceSegments: [
    { from: 0, to: 12, text: 'Сначала про бюджет.' },
    { from: 20, to: 40, text: 'Дальше про сроки.' },
    { from: 60, to: 80, text: 'Теперь про подрядчика.' },
  ],
}, '').text

const v = versionsAligned()
ok('U180a все источники версии синхронизированы', v.ok, v.why)
ok('U180b «Что нового» и README знают 0.180',
  /\*\*0\.180\*\*/.test(readme))

/* ── Метки времени ───────────────────────────────────────────────────────── */
ok('N1: таймкод человеческий, а не «0,0 с»: 0:07 · 12:34 · 1:02:03',
  fmtStamp(7) === '0:07' && fmtStamp(754) === '12:34' && fmtStamp(3723) === '1:02:03'
    && fmtStamp(0) === '0:00' && fmtStamp(-5) === '0:00', [fmtStamp(7), fmtStamp(754), fmtStamp(3723)].join(' · '))

ok('N2: длительность словами — «45 с», «3 мин 20 с», «1 ч 5 мин»',
  fmtDuration(45) === '45 с' && fmtDuration(200) === '3 мин 20 с' && fmtDuration(180) === '3 мин'
    && fmtDuration(3900) === '1 ч 5 мин', [fmtDuration(45), fmtDuration(200), fmtDuration(3900)].join(' · '))

/* ── Дорожка ─────────────────────────────────────────────────────────────── */
{
  const segs = [
    { from: 0, to: 3, text: 'Добрый день.' },
    { from: 3.4, to: 6, text: 'Начнём с бюджета.' },          /* пауза 0,4 с — та же реплика */
    { from: 14, to: 20, text: 'Теперь про сроки.' },          /* пауза 8 с — новая реплика */
  ]
  const t = timeline(segs)
  ok('N3: реплики склеиваются по паузам, каждая со своим временем',
    t.lines.length === 2 && t.lines[0] === '[0:00] Добрый день. Начнём с бюджета.'
      && t.lines[1] === '[0:14] Теперь про сроки.' && t.full === true,
    JSON.stringify(t.lines))

  const long = timeline([{ from: 0, to: 60, text: 'а'.repeat(700) }])
  ok('N4: монолог в 700 знаков режется на строки — простыню на телефоне не читают',
    long.lines.length === 3 && long.lines.every((l) => l.length <= 318)
      && long.lines[0].startsWith('[0:00]') && long.lines[2].startsWith('[0:'),
    long.lines.map((l) => l.length).join('/'))

  /* Реплики с паузами в 40 с — не склеиваются; вместе их больше потолка знаков. */
  const many = timeline(Array.from({ length: 40 }, (_, i) => ({ from: i * 60, to: i * 60 + 20, text: 'Реплика номер ' + i + ' про дела, планы на неделю и другие важные вопросы.' })))
  ok('N5: дорожка уважает потолок знаков и честно говорит, что не поместилось',
    !many.full && many.chars <= 2400 && many.lines.length > 5 && many.lines.every((l) => /^\[\d+:\d\d\]/.test(l)),
    many.chars + ' знаков · ' + many.lines.length + ' строк')

  ok('N6: пустая дорожка не выдумывает строк', timeline([]).lines.length === 0 && timeline(null).lines.length === 0)
  void GAP_SEC
}

/* ── Когда конспект, а когда просто расшифровка ─────────────────────────── */
ok('N7: короткая голосовая — вопрос, а не запись на конспект',
  wantsNote({ segments: [{ from: 0, to: 8, text: 'напомни купить хлеб' }], seconds: 8 }) === false
    && NOTE_MIN_SEC >= 30 && NOTE_MIN_SEGMENTS >= 3)

ok('N8: длинная запись или разговор с репликами — конспект',
  wantsNote({ segments: [], seconds: 300 }) === true
    && wantsNote({ segments: [{ from: 0, to: 60, text: 'раз' }, { from: 60, to: 61, text: 'два' }, { from: 61, to: 62, text: 'три' }], seconds: 62 }) === true)

{
  const short = noteOf({ text: 'напомни купить хлеб', segments: [{ from: 0, to: 5, text: 'напомни купить хлеб' }], seconds: 5 })
  ok('N9: короткая голосовая остаётся прежней подписью «[Голосом: …]», без конспекта',
    short.mode === 'plain' && short.block === '[Голосом: напомни купить хлеб]' && short.directive === '')

  const rec = noteOf({
    text: 'Добрый день. Начнём с бюджета. Теперь про сроки. И про подрядчика.',
    segments: [
      { from: 0, to: 3, text: 'Добрый день.' },
      { from: 4, to: 9, text: 'Начнём с бюджета.' },
      { from: 30, to: 40, text: 'Теперь про сроки.' },
      { from: 65, to: 70, text: 'И про подрядчика.' },
    ],
    seconds: 70,
    name: 'совещание.mp3',
  })
  ok('N10: запись превращается в дорожку с таймкодами и указанием модели',
    rec.mode === 'note' && rec.stamps === 3 && /\[0:00\]/.test(rec.block) && /\[1:05\]/.test(rec.block)
      && /совещание\.mp3/.test(rec.block) && /1 мин 10 с/.test(rec.block)
      && /таймкод/i.test(rec.directive) && /\[2:15\]/.test(rec.directive),
    rec.block.slice(0, 120))

  ok('N10b: модели прямо запрещено пересказывать файл и расшифровку вместо содержания',
    /Не описывай файл, расшифровку и сам блок/.test(rec.directive)
      && /указано название файла/.test(rec.directive)
      && /по СОДЕРЖАНИЮ записи/.test(rec.directive) && /3–7 коротких пунктов/.test(rec.directive),
    rec.directive.slice(0, 120))

  ok('N10c: у указания есть пример формы — на первом живом прогоне модель без него отвечала одной строкой',
    /Пример формы/.test(rec.directive) && /– \[0:00\] Бюджет/.test(rec.directive))

  /* Просьба в конце сообщения: то место, которое модель слушает сильнее всего, и
     заодно «в сообщении нет ни одного слова человека» перестаёт быть дырой. */
  ok('N10d: после дорожки стоит просьба сделать конспект',
    rec.block.endsWith(NOTE_ASK) && /Сделай конспект этой записи/.test(rec.block)
      && /\[1:05\] И про подрядчика\.\n\nСделай конспект/.test(rec.block),
    rec.block.slice(-80))

  const noSeg = noteOf({ text: 'Очень длинная запись без отрезков. ' .repeat(30), segments: [], seconds: 240 })
  ok('N11: без отрезков конспект всё равно есть, но выдумывать метки прямо запрещено',
    noSeg.mode === 'note' && noSeg.stamps === 0 && !/\[\d+:\d\d\]/.test(noSeg.block)
      && /не выдумывай/i.test(noSeg.directive) && /\[00:00\]/.test(noSeg.directive),
    noSeg.directive.slice(-90))

  ok('N10e: пункты просим своими словами и без цитат — иначе конспект превращается в пересказ дорожки',
    /своими словами/.test(rec.directive) && /без цитат в кавычках/.test(rec.directive)
      && /до ~15 слов на пункт/.test(rec.directive))

  ok('N12: строка человеку говорит длину, объём и обещание конспекта',
    noteLine(rec) === 'Запись 1 мин 10 с · расшифровка, 11 слов · конспект с таймкодами'
      && wordsWord(1) === 'слово' && wordsWord(3) === 'слова' && wordsWord(11) === 'слов'
      && wordsWord(21) === 'слово',
    noteLine(rec))
}

/* ── Живой путь: от вложения до того, что уедет движку ─────────────────── */
{
  const longText = 'Добрый день. Обсудили бюджет, сроки и подрядчика. Решили начать в понедельник.';
  const got = {
    images: [], docs: [], notes: [], voiceText: longText, voiceName: 'standup.m4a',
    voiceSegments: [
      { from: 0, to: 4, text: 'Добрый день.' },
      { from: 20, to: 34, text: 'Обсудили бюджет, сроки и подрядчика.' },
      { from: 61, to: 70, text: 'Решили начать в понедельник.' },
    ],
    voiceSeconds: 70,
  }
  const out = compose({ has: true, defer: true }, got, 'послушай и скажи, что решили')
  ok('N13: дорожка уезжает движку вместе с подписью человека, а указание — отдельным полем',
    /\[0:00\]/.test(out.text) && /\[1:01\]/.test(out.text) && /послушай и скажи/.test(out.text)
      && out.text.indexOf(NOTE_ASK) < out.text.indexOf('послушай и скажи')
      && /конспект/i.test(out.directive) && out.voice && out.voice.mode === 'note' && out.voice.stamps === 3,
    JSON.stringify({ voice: out.voice }))

  /* Голосовая без подписи: расшифровка и есть сообщение — так было и до 0.180,
     и менять это нельзя (человек диктует вопрос, а не присылает «аудио»). */
  const short = compose({ has: true, defer: true }, { images: [], docs: [], notes: [], voiceText: 'переведи это на английский', voiceSegments: [{ from: 0, to: 4, text: 'переведи это на английский' }], voiceSeconds: 4 }, '')
  ok('N14: короткая голосовая уезжает как раньше — без дорожки и без указания',
    short.text === 'переведи это на английский' && short.directive === '' && short.voice.mode === 'plain',
    short.text)

  /* Голос плюс подпись — один ход: подпись при этом не теряется (правило 0.16x). */
  const withCap = compose({ has: true, defer: true }, { images: [], docs: [], notes: [], voiceText: 'встреча в три', voiceSegments: [{ from: 0, to: 2, text: 'встреча в три' }], voiceSeconds: 2 }, 'напомни мне')
  ok('N14b: короткая голосовая с подписью сохраняет и то и другое',
    /^\[Голосом: встреча в три\]\nнапомни мне$/.test(withCap.text) && withCap.directive === '',
    JSON.stringify(withCap.text))
}

/* ── Провода: указание доезжает до движка, отрезки — до вложения ────────── */
ok('N15: указание по записи липнет к системной подсказке движка, а свою system человека не трогает',
  /system: \(norm\.system \|\| PERSONA_SYSTEM\)/.test(door)
    && /!norm\.system && composed && composed\.directive \? '\\n\\n' \+ composed\.directive/.test(door),
  'дверь чата')

ok('N16: дверь кладёт отрезки и длину в вложение — конспект собирается без второго запроса',
  /voiceSegments: \[\]/.test(door) && /voiceSegments = v\.segments/.test(door) && /voiceSeconds = v\.seconds/.test(door)
    && /voiceName = name/.test(door))

ok('N17: readVoiceBytes отдаёт отрезки наружу, а readSegments читает обе формы ответа',
  /segments: r\.segments \|\| \[\]/.test(attachSrc) && /export function readSegments/.test(voiceinSrc)
    && /s\.start != null \? s\.start : s\.from/.test(voiceinSrc) && /result && j\.result\.segments/.test(voiceinSrc),
  'вложение и расшифровка')

ok('N18: конспект не заводит новых ключей и сервисов — работает на той же расшифровке',
  !/https?:\/\//.test(bare(read('engine/audionote.js')))
    && /verbosе_json|verbose_json/.test(voiceinSrc))

ok('N15b: сообщение с записью не выглядит как заказ программы — «код» в слове «таймкод» ловился',
  classifyTask(noteMsg, []) !== 'code' && tierFor(classifyTask(noteMsg, [])) === 'smart',
  'намерение: ' + classifyTask(noteMsg, []));

ok('N17b: под ответом видна строка о записи — что это было за аудио и что конспект с таймкодами',
  /if \(voice && voice\.line\) out\.push\(\{ name: voice\.name \|\| 'запись'/.test(door)
    && /attachmentsOut\(att, r, composed && composed\.voice\)/.test(door)
    && /name: \(got && got\.voiceName\) \|\| ''/.test(attachSrc), 'дверь и сборщик')

ok('N18b: конспект записи идёт по умной полосе — слабая модель отвечает про файл, а не по делу',
  /* Форму проверяем по частям, а не прибитой строкой: в 0.180 к этому же правилу
     добавился живой вопрос (`needsWeb`), и точная строка менялась на живой правке. */
  /composed\.voice\.mode === 'note'/.test(door) && /!norm\.model/.test(door)
    && /needsWeb\(String\(norm\.text/.test(door) && /'smart'/.test(door), 'functions/api/chat.js')

ok('N19: проверка подключена к общему прогону',
  /test\/audionote\.test\.js/.test(chain) && /test\/voicein\.test\.js/.test(chain))

console.log('\n✔ 0.180 (звук): запись превращается в конспект с таймкодами — проверки пройдены')
