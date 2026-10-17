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
    block.includes('«дрочку»') && /Не переводи его лексику/.test(block) && /звёздочек/.test(block),
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
    body1.includes('【Лексика собеседника — зеркало') && body1.includes('дрочку'),
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
    r3.ok && r3.lexiconRestored === false && !body3.includes('Лексика собеседника'), r3.reply)

  /* Чужая system (головы совета и сервисные вызовы) зеркала не получает. */
  const f4 = fakeFetch(() => chat('Стимуляция.'))
  const e4 = createEngine({ env: { GROQ_KEYS: 'g1' }, fetch: f4, sleep: async () => {} })
  const r4 = await e4.run({ text: 'дрочка', system: 'Отвечай одним словом.', noCouncils: true })
  const body4 = JSON.stringify((f4.calls[0] || {}).body || {})
  ok('N6: своя system от вызывающего остаётся его территорией (ни блока зеркала, ни обратной замены)',
    r4.ok && !body4.includes('Лексика собеседника') && r4.reply === 'Стимуляция.' && r4.lexiconRestored === false,
    { reply: r4.reply, body: body4.slice(0, 120) })

  ok('N7: дверь отдаёт флаг наружу — curl видит, что зеркало сработало',
    read('functions/api/chat.js').includes('lexiconRestored: !!r.lexiconRestored'))
  ok('N8: тест включён в общую цепочку npm test',
    JSON.parse(read('package.json')).scripts.test.includes('node test/lexicon.test.js'))
}

console.log('\n' + pass + ' пройдено, 0 провалено')
