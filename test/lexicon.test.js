/**
 * Зеркало лексики (0.203) — против «тихого смягчения».
 *
 * Человек жалуется (его слова): «цензура обходится, но агентик как будто
 * боится сказать плохие слова или заменяет их на другие: слово „дрочка"
 * переводит в „стимуляцию"». Здесь проверяется поведение, а не поля:
 * промпт получает его конкретные слова и запрет перевода, смягчённый
 * ответ возвращается к его словарю с падежами, а бытовая и научная речь
 * при этом не страдает.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as lexicon from '../engine/lexicon.js'
import * as freedom from '../engine/freedom.js'
import { createEngine } from '../engine/chat.js'

let pass = 0
const ok = (name, cond, extra) => {
  assert.ok(cond, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  pass++; console.log('  ✔ ' + name)
}
const read = (p) => readFileSync(p, 'utf8')

console.log('L — зеркало лексики: обнаружение и подсказка')
{
  const src = ['расскажи про дрочку: как правильно дрочить и чем это полезно']
  ok('L1: прямая лексика находится его же формами',
    lexicon.explicitWords(src).join(',') === 'дрочку,дрочить',
    lexicon.explicitWords(src))

  const block = lexicon.mirrorBlock(src)
  ok('L2: блок зеркала несёт его слова и запрет клинического перевода',
    block.includes('«дрочку»') && /Запрещено «поправлять»/.test(block) && /звёздочек/.test(block),
    block.split('\n')[1])

  ok('L3: бытовая речь и ложные друзья зеркало не будят (страха, тебя, небо, анализ)',
    lexicon.mirrorBlock(['у меня нет страха, я тебя спросил про небо и анализ крови']) === ''
      && !freedom.isAdultAsk('никакого страха нет, нужен анализ данных и трахея болит'))

  ok('L4: просьба по-научному/без мата сильнее зеркала — блока нет, обратной замены нет',
    lexicon.mirrorBlock(['что такое дрочка по-научному?']) === ''
      && lexicon.restore('Это называется мастурбацией.', ['как дрочка называется по-научному?']).changed === false)

  ok('L5: LEXICON=0 выключает слой целиком',
    lexicon.mirrorBlock(src, { LEXICON: '0' }) === ''
      && lexicon.restore('Стимуляция — дело обычное.', src, { LEXICON: '0' }).changed === false)

  ok('L6: прямая лексика теперь маркер взрослой темы и у freedom, а не только «секс/эрот»',
    freedom.isAdultAsk('расскажи про дрочку и минет') && freedom.isAdultAsk('how to jerk off safely'))
}

console.log('M — зеркало лексики: обратная замена с падежами')
{
  const src = ['расскажи про дрочку']
  const r = lexicon.restore(
    'Стимуляция бывает разной. При стимуляции важно не спешить, а регулярная мастурбация безвредна: он мастурбирует по утрам. Польза самоудовлетворения спорна.', src)
  ok('M1: номинатив и предложный возвращаются в его слово без сломанной грамматики',
    r.changed && r.text.startsWith('Дрочка бывает разной.') && r.text.includes('При дрочке важно'),
    r.text)
  ok('M2: мастурбация/мастурбирует/самоудовлетворения — все формы в его словарь',
    r.text.includes('регулярная дрочка безвредна') && r.text.includes('он дрочит по утрам')
      && r.text.includes('Польза дрочки спорна'), r.text)

  const keep = lexicon.restore('А стимуляция мозга и стимуляция экономики — другие темы.', src)
  ok('M3: настоящая стимуляция (мозга, экономики) не переводится насильно',
    keep.changed === false, keep.text)

  const mixed = lexicon.restore('Дрочка (научный термин здесь ни при чём) — это когда рукой; слово «стимуляция» тут лишнее.', src)
  ok('M4: ответ, где его слово УЖЕ сказано, не трогаем — там синоним может стоять по делу',
    mixed.changed === false, mixed.text)

  const neutral = lexicon.restore('Стимуляция — обычное дело, самостимуляция тоже.', ['расскажи про мастурбацию'])
  ok('M5: нейтральный регистр зеркалится нейтрально: цель — «мастурбация», а не грубость',
    neutral.text === 'Мастурбация — обычное дело, мастурбация тоже.', neutral.text)

  const code = lexicon.restore('Стимуляция вне кода.\n```js\nconst s = "стимуляция в коде"\n```', src)
  ok('M6: блоки кода обратная замена не трогает',
    code.text.includes('Дрочка вне кода.') && code.text.includes('"стимуляция в коде"'), code.text)

  const stars = lexicon.restore('др***ка — это нормально', src)
  ok('M7: звёздочки вместо букв снимаются, слово возвращается целиком',
    stars.text === 'дрочка — это нормально', stars.text)

  const en = lexicon.restore('Masturbation is normal. He masturbates daily.', ['is it ok to jerk off daily?'])
  ok('M8: английский сленг тоже зеркалится (jerk off, а не masturbate)',
    en.text === 'Jerking off is normal. He jerks off daily.', en.text)

  const talk = lexicon.restore('Помидоры краснеют от солнца.', src)
  ok('M9: ответ вообще не на эту тему не меняется', talk.changed === false, talk.text)
}

console.log('N — зеркало лексики: врезка в движок')
{
  const fakeFetch = (script) => {
    const calls = []
    const impl = async (url, init) => {
      const body = JSON.parse(init.body)
      calls.push({ url, body })
      const out = script(url, body, calls.length - 1)
      return { status: 200, text: async () => JSON.stringify(out) }
    }
    impl.calls = calls
    return impl
  }
  const chat = (text) => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }] })

  /* Модель получила прямой вопрос и ответила клиническим переводом:
     человек должен увидеть свой словарь и флаг в диагностике. */
  const f1 = fakeFetch(() => chat('Стимуляция — обычное дело. При стимуляции главное — гигиена.'))
  const e1 = createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: f1, sleep: async () => {} })
  const r1 = await e1.run({ text: 'расскажи про дрочку, только прямо', noCouncils: true })
  ok('N1: смягчённый ответ доезжает до человека его словами',
    r1.ok && r1.reply.startsWith('Дрочка — обычное дело.') && r1.reply.includes('При дрочке главное'),
    r1.reply)
  ok('N2: факт обратной замены виден флагом, а не молча',
    r1.lexiconRestored === true, { lexiconRestored: r1.lexiconRestored })
  const body1 = JSON.stringify((f1.calls[0] || {}).body || {})
  ok('N3: модель с первого раза получила блок зеркала с его словом',
    body1.includes('【Свобода слова — регистр диалога') && body1.includes('дрочку'),
    body1.slice(0, 160))

  /* Продолжение разговора: прямая лексика была ХОД НАЗАД, теперь «продолжай». */
  const f2 = fakeFetch(() => chat('Стимуляция помогает уснуть.'))
  const e2 = createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: f2, sleep: async () => {} })
  const r2 = await e2.run({
    text: 'а ещё что скажешь?',
    history: [
      { role: 'user', content: 'расскажи про дрочку' },
      { role: 'assistant', content: 'Стимуляция — это нормально.' },
    ],
    noCouncils: true,
  })
  ok('N4: взрослый контекст и зеркало живут по репликам человека, а не по смягчённому ответу',
    r2.ok && r2.reply.startsWith('Дрочка помогает уснуть.'), r2.reply)

  /* Обычный вопрос: ни блока, ни флага — промпт и ответ прежние. */
  const f3 = fakeFetch(() => chat('Париж стоит на Сене.'))
  const e3 = createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: f3, sleep: async () => {} })
  const r3 = await e3.run({ text: 'расскажи про Париж', noCouncils: true })
  const body3 = JSON.stringify((f3.calls[0] || {}).body || {})
  ok('N5: на бытовом вопросе зеркала нет и ответ не трогается',
    r3.ok && r3.lexiconRestored === false && !body3.includes('Свобода слова — регистр'), r3.reply)

  /* Чужая system (головы совета и сервисные вызовы) зеркала не получает. */
  const f4 = fakeFetch(() => chat('Стимуляция.'))
  const e4 = createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: f4, sleep: async () => {} })
  const r4 = await e4.run({ text: 'дрочка', system: 'Отвечай одним словом.', noCouncils: true })
  const body4 = JSON.stringify((f4.calls[0] || {}).body || {})
  ok('N6: своя system от вызывающего остаётся его территорией (ни блока зеркала, ни обратной замены)',
    r4.ok && !body4.includes('Свобода слова — регистр') && r4.reply === 'Стимуляция.' && r4.lexiconRestored === false,
    { reply: r4.reply, body: body4.slice(0, 120) })

  ok('N7: дверь отдаёт флаг наружу — curl видит, что зеркало сработало',
    read('functions/api/chat.js').includes('lexiconRestored: !!r.lexiconRestored'))
  ok('N8: тест включён в общую цепочку npm test',
    JSON.parse(read('package.json')).scripts.test.includes('node test/lexicon.test.js'))
}

console.log('O — словарь понятий, смысл по теме и памяти (0.204)')
{
  ok('O1: словарь понятий собран сам: не меньше десяти понятий со словарём темы',
    lexicon.CONCEPTS.length >= 10 && lexicon.CONCEPTS.every((c) => c.id && c.title && c.vocab.length >= 2),
    lexicon.CONCEPTS.map((c) => c.id).join(','))

  ok('O2: «член семьи/команды» — не анатомия: понятий нет, блока нет',
    lexicon.detectConcepts(['член нашей семьи получил наследство, а член команды уехал']).length === 0
      && lexicon.mirrorBlock(['расскажи про члена семьи, он уехал']) === '')

  const mem = lexicon.detectConcepts(['а член 20 см — это много?', 'расскажи про секс честно'])
  ok('O3: память темы оживляет омоним: после «про секс» член — анатомия',
    mem.some((c) => c.id === 'penis' && c.register === 'colloquial'), JSON.stringify(mem))

  ok('O4: «кончил школу» — не оргазм; с взрослой темой в памяти «кончил» читается по теме',
    lexicon.detectConcepts(['он кончил школу и поступил в вуз']).length === 0
      && lexicon.detectConcepts(['я опять быстро кончил', 'мы занимались сексом'])
        .some((c) => c.id === 'orgasm' && c.register === 'colloquial'))

  const blk = lexicon.mirrorBlock(['расскажи про дрочку и минет'])
  ok('O5: блок несёт понятия его словами и словарь темы, а не обязанность повторять',
    blk.includes('мастурбация — «дрочку»') && blk.includes('Словарь темы')
      && /Не обязательно повторять/.test(blk) && /Никакое слово само по себе не запрещено/.test(blk),
    blk.split('\n').slice(0, 3).join(' | '))

  ok('O6: возрастных ворот нет, настоящий риск по делу — можно после сути',
    /Возраст не допрашивай/.test(blk) && /настоящий риск/i.test(blk) && /после ответа/i.test(blk))

  ok('O7: мат без взрослой темы тоже регистр: блок есть, понятий может не быть',
    lexicon.mirrorBlock(['бля, как достал этот баг, чини давай']).includes('【Свобода слова')
      && lexicon.profanityWords(['бля, как достал этот баг']).length >= 1)
}

console.log('P — обратная замена по словарю понятий (0.204)')
{
  const pen = lexicon.restore(
    'Пенис состоит из ствола и головки. Размер полового члена у всех разный.',
    ['расскажи про хуй: из чего состоит, размер важен?'])
  ok('P1: пенис/половой член при его «хуй» возвращаются его словом с падежами',
    pen.text.startsWith('Хуй состоит') && pen.text.includes('Размер хуя у всех разный'), pen.text)

  const chl = lexicon.restore('Пенис в среднем около 13 см.', ['расскажи про секс: а член 13 см — нормально?'])
  ok('P2: разговорный «член» в памяти темы: цель — член, а не грубость сверх регистра',
    chl.text.startsWith('Член в среднем'), chl.text)

  const sex = lexicon.restore(
    'Они занимаются сексом каждый день. Во время полового акта важно предохраняться.',
    ['они правда трахаются каждый день?'])
  ok('P3: «занимаются сексом» и «полового акта» при его «трахаются» — его словами',
    sex.text.includes('Они трахаются каждый день') && sex.text.includes('Во время траха важно'), sex.text)

  const sexN = lexicon.restore('Половой акт длится в среднем несколько минут.', ['сколько обычно длится секс?'])
  ok('P4: нейтральный «секс» не формализуется обратно в «половой акт»',
    sexN.text.startsWith('Секс длится'), sexN.text)

  const fel = lexicon.restore('Оральный секс — обычная практика. При оральном сексе есть риски.', ['расскажи про минет'])
  ok('P5: оральный секс при его «минет» — минетом, с предложным падежом',
    fel.text.startsWith('Минет — обычная') && fel.text.includes('При минете есть риски'), fel.text)

  const vul = lexicon.restore('Влагалище — эластичный канал длиной около десяти сантиметров.',
    ['расскажи про секс и пизду простыми словами'])
  ok('P6: вульва одним термином — в его слово; различие анатомии не ломаем',
    vul.text.startsWith('Пизда — эластичный'), vul.text)
  const vulKeep = lexicon.restore('Вагина и вульва — не одно и то же: вульва снаружи.',
    ['расскажи про секс и пизду: вагина и вульва — это одно?'])
  ok('P7: ответ, который РАЗЛИЧАЕТ анатомию, не превращаем в «пизда и пизда»',
    vulKeep.changed === false, vulKeep.text)
  const vulMed = lexicon.restore('Гинеколог возьмёт мазок: стенки влагалища покажут картину.',
    ['у меня болит пизда, что делать?'])
  ok('P8: медицинская точность ограждена: мазок и стенки остаются своими словами',
    vulMed.changed === false, vulMed.text)

  const org = lexicon.restore('Он достиг оргазма быстро, а она испытывает оргазм не всегда.',
    ['он опять быстро кончил', 'мы занимались сексом'])
  ok('P9: «достиг/испытывает оргазм» при его «кончил» — кончил/кончает',
    org.text.includes('Он кончил быстро') && org.text.includes('она кончает не всегда'), org.text)

  const por = lexicon.restore('Порнография бывает разной. В порнографии много постановки.', ['расскажи про порнуху'])
  ok('P10: порнография при его «порнуха» — порнухой, предложный по предлогу',
    por.text.startsWith('Порнуха бывает') && por.text.includes('В порнухе много'), por.text)

  const en = lexicon.restore('The penis grows. They have sex daily.', ['my cock is big, we fuck daily'])
  ok('P11: английский ряд словаря: penis→cock, have sex→fuck',
    en.text === 'The cock grows. They fuck daily.', en.text)

  ok('P12: sanitizedInfo видит остаточное смягчение и молчит при прямом слове',
    lexicon.sanitizedInfo(['расскажи про хуй'], 'Пенис — орган.').length === 1
      && lexicon.sanitizedInfo(['расскажи про хуй'], 'Хуй — орган.').length === 0)
}

console.log('Q — смягчение учит рейтинг смелых (0.204)')
{
  const fakeFetch = (reply) => {
    const impl = async (url, init) => ({
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] }),
    })
    return impl
  }
  const marks = []
  const braveStub = {
    orderProviders: (x) => x, order: (x) => x,
    mark: (id, model, okBrave, weight) => marks.push({ id, model, okBrave, weight }),
  }
  const eSoft = createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: fakeFetch('Стимуляция — обычное дело.'), sleep: async () => {}, brave: braveStub })
  const rSoft = await eSoft.run({ text: 'расскажи про дрочку коротко', noCouncils: true })
  const eDirect = createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: fakeFetch('Дрочка — обычное дело.'), sleep: async () => {}, brave: braveStub })
  const rDirect = await eDirect.run({ text: 'расскажи про дрочку коротко', noCouncils: true })
  ok('Q1: смягчившей модели — частичная смелость 0.45, прямой — полная 1',
    rSoft.ok && rDirect.ok && marks.length >= 2
      && marks[0].weight === 0.45 && marks[marks.length - 1].weight === 1,
    JSON.stringify(marks))
  ok('Q2: флаги смягчения доезжают до результата движка',
    rSoft.lexiconRestored === true && rDirect.lexiconRestored === false && rDirect.lexiconSanitized === false,
    { soft: rSoft.lexiconRestored, direct: rDirect.lexiconRestored })
}

console.log('\nИскажённое написание (0.205)')
{
  const { denoise, obfuscatedWords, detectConcepts, hasAdultTopic, mirrorBlock, restore } = lexicon
  ok('R1: цифры-омоглифы и смесь алфавитов читаются',
    denoise('скажи про Dro4ку') === 'скажи про дрочку'
      && denoise('др0чка и с3кс') === 'дрочка и секс'
      && /дрочка/.test(denoise('д' + 'po' + 'чк' + 'a')))
  ok('R2: транслит читается целиком',
    denoise('они trahatsya, а это drochka и seks') === 'они трахаться, а это дрочка и секс'
      && denoise('xuy и chlen') === 'хуй и член'
      && denoise('sex') === 'секс')
  ok('R3: звёздочки, дефисы и разрядка читаются',
    denoise('др***ка, х*й и с*кс') === 'дрочка, хуй и секс'
      && denoise('д-р-о-ч-к-а и с.е.к.с') === 'дрочка и секс'
      && denoise('д р о ч к а вредна?') === 'дрочка вредна?')
  ok('R4: обычная речь и имена не искажаются нормализацией',
    denoise('кое-что про северо-запад') === 'кое-что про северо-запад'
      && denoise('eBay и channel на youtube') === 'eBay и channel на youtube'
      && denoise('**привет**, как дела') === '**привет**, как дела'
      && detectConcepts(['член семьи, анализ данных, eBay и channel']).length === 0)
  ok('R5: искажённое даёт понятие и взрослую тему',
    detectConcepts(['расскажи про Dro4ку']).some((c) => c.id === 'masturbation' && c.register === 'vulgar' && c.words.includes('дрочку'))
      && hasAdultTopic(['д р о ч к а вредна?'])
      && freedom.isAdultAsk('расскажи про Dro4ку')
      && !freedom.isAdultAsk('расскажи про channel и eBay'))
  ok('R6: подсказка: искажённое понять, отвечать нормальными словами',
    (() => { const m = mirrorBlock(['скажи про Dro4ку и др***ку']); return m.includes('искажённо') && m.includes('Dro4ку') && m.includes('нормальными словами') && m.includes('не переспрашивай') })()
      && JSON.stringify(obfuscatedWords(['про Dro4ку и с е к с'])) === JSON.stringify(['с е к с', 'Dro4ку']))
  ok('R7: обратная замена работает и от искажённого источника',
    restore('Это мастурбация: стимуляция пениса.', ['скажи про Dro4ку и xuy']).text === 'Это дрочка: дрочка хуя.'
      && restore('Заниматься сексом полезно.', ['они любят trahatsya']).text === 'Трахаться полезно.')
}

console.log('\nЗвёздочки двусмысленны (0.206)')
{
  const { denoise, detectConcepts, ambiguousMasks, mirrorBlock } = lexicon
  ok('S1: «м***т» без контекста НЕ приписывается взрослому значению',
    denoise('купи м***т и гвозди') === 'купи м***т и гвозди'
      && detectConcepts(['купи м***т и гвозди']).length === 0
      && denoise('надо е*ать домой уже') === 'надо е*ать домой уже'
      && denoise('сколько м*нет в кармане') === 'сколько м*нет в кармане')
  ok('S2: та же маска во взрослом контексте читается взрослым словом',
    denoise('про секс: она делает м***т') === 'про секс: она делает минет'
      && denoise('секс, трах: е*ать всю ночь') === 'секс, трах: ебать всю ночь'
      && detectConcepts(['мы говорили про секс', 'а м***т это как?']).some((c) => c.id === 'fellatio'))
  ok('S3: спорные маски отдаются модели вариантами, а не вердиктом',
    (() => {
      const a = ambiguousMasks(['купи м***т, да м*нет добавь'])
      return a.length === 2 && a[0].adult === 'минет' && a[0].neutrals.includes('молот') && a[0].neutrals.includes('мазут')
        && a[1].neutrals.includes('монет')
    })())
  ok('S4: подсказка о двусмысленности: по смыслу; без понятий — короткая форма',
    (() => {
      const mini = mirrorBlock(['купи м***т и гвозди'])
      return mini.includes('Слова со звёздочками') && mini.includes('по СМЫСЛУ фразы')
        && !mini.includes('Свобода слова')
    })()
      && mirrorBlock(['расскажи про дрочку и м***т']).includes('двусмысленным'))
  ok('S5: однозначные маски работают как раньше',
    denoise('др***ка, х*й и с*кс') === 'дрочка, хуй и секс'
      && denoise('расскажи про Мineт') === 'расскажи про минет')
}

console.log('\n' + pass + ' пройдено, 0 провалено')
