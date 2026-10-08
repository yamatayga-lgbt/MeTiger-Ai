/**
 * Проба голоса с этой машины: озвучить фразу и получить mp3 файлом.
 *
 * Нужна не для продукта, а для проверки снаружи: движок озвучки (engine/voiceout.js)
 * живёт в Cloudflare, и когда что-то молчит, важно понимать — это служба голоса,
 * рантайм или наш разбор. Проба повторяет тот же протокол на node с пакетом `ws`:
 *
 *   npm i ws --no-save && node scripts/tts-probe.mjs ru-RU-DmitryNeural audio-24khz-48kbitrate-mono-mp3 "Текст" /tmp/проба.mp3
 *
 * Все параметры (адрес, токен, версия Chrome, подпись времени) — те же, что в движке;
 * если проба работает, а вход /api/tts молчит — дело в рантайме, и наоборот.
 */
/* Проба: бесплатная озвучка Microsoft (движок «читать вслух» в Edge).
   Все параметры — как в рабочей библиотеке edge-tts 7.2.8: токен и версия GEC
   стоят в АДРЕСЕ соединения, а не в заголовках (на этом была ошибка 403). */
import WebSocket from 'ws'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const CHROME = '143.0.3650.75'

function gec() {
  let t = Date.now() / 1000 + 11644473600
  t -= t % 300
  t *= 1e7
  return createHash('sha256').update(String(BigInt(Math.round(t))) + TOKEN, 'ascii').digest('hex').toUpperCase()
}

const голос = process.argv[2] || 'ru-RU-DmitryNeural'
const формат = process.argv[3] || 'audio-24khz-48kbitrate-mono-mp3'
const текст = process.argv[4] || 'Привет! Это проверка русского голоса в MeTiger.'
const out = process.argv[5] || '/tmp/tts/проба.mp3'

const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TOKEN}`
  + `&ConnectionId=${randomUUID().replace(/-/g, '')}&Sec-MS-GEC=${gec()}&Sec-MS-GEC-Version=1-${CHROME}`
const ws = new WebSocket(url, {
  headers: {
    'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
    'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0`,
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'en-US,en;q=0.9',
    'Pragma': 'no-cache',
    'Cache-Control': 'no-cache',
    'Cookie': 'muid=' + randomBytes(16).toString('hex').toUpperCase() + ';',
  },
})

const куски = []
const таймер = setTimeout(() => { console.log('ТАЙМАУТ'); ws.close() }, 25000)

ws.on('open', () => {
  const id = randomUUID().replace(/-/g, '')
  const conf = JSON.stringify({
    context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false }, outputFormat: формат } } },
  })
  ws.send(`X-Timestamp:${new Date().toString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${conf}`)
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ru-RU'><voice name='${голос}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${текст}</prosody></voice></speak>`
  ws.send(`X-RequestId:${id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toString()}Z\r\nPath:ssml\r\n\r\n${ssml}`)
})

ws.on('message', (data, isBinary) => {
  if (!isBinary) {
    if (/Path:turn\.end/.test(data.toString())) { ws.close(); return }
    return
  }
  /* Бинарный кадр: два байта длины заголовка (big-endian), сам заголовок, затем —
     после двух байт-разделителей — аудио. Так же читает библиотека edge-tts. */
  const buf = Buffer.from(data)
  const hl = buf.readUInt16BE(0)
  if (hl > buf.length) { куски.push(buf); return }
  const заголовки = buf.slice(2, hl).toString()
  if (!/Path:\s*audio/.test(заголовки)) return
  куски.push(buf.slice(hl + 2))
})

ws.on('close', () => {
  clearTimeout(таймер)
  const всего = Buffer.concat(куски)
  writeFileSync(out, всего)
  const маг = всего.slice(0, 4).toString('binary')
  console.log('закрыто, байт:', всего.length, '| первые байты:', JSON.stringify(маг), всего.slice(0, 4).toString('hex'), '→', out)
})

ws.on('error', (e) => { clearTimeout(таймер); console.log('ОШИБКА:', String(e.message || e).slice(0, 160)) })
