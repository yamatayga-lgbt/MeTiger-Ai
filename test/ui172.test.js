/**
 * 0.172: починка голоса. 0.188: разговор вслух и озвучку убрали, диктовка стала
 * умнее — и проверки переведены на новое состояние.
 *
 * Две половины голоса сломались 12 окт 2026 по одной общей причине — молчание.
 * Озвучка: служба Microsoft закрыла старый адрес (403), и это видно не в логах, а
 * в ответе /api/tts «служба голоса не дала соединения». Ввод: у движка браузера
 * есть третье состояние — «принял и молчит», и серверные слои включались только
 * после явной ошибки, поэтому человек видел «Слушаю» и пустое поле.
 *
 * Живым остался адрес службы (движок нужен /api/tts — внешним клиентам API) и
 * сторож молчания. Разговор вслух (переключатель, автоотправка, перебить) удалён
 * по решению владельца — теперь вместо него проверки того, что от режима не
 * осталось даже следов, а диктовка сама гаснет в тишине и ставит знаки голосом.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { versionsAligned } from './version-sync.js'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}

const notes = readFileSync('src/lib/release-notes.ts', 'utf8')
const readme = readFileSync('README.md', 'utf8')
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const voice = readFileSync('src/lib/voice.ts', 'utf8')
const chat = readFileSync('src/views/ChatView.tsx', 'utf8')
const menu = readFileSync('src/components/AttachMenu.tsx', 'utf8')
const css = readFileSync('src/styles/index.css', 'utf8')
const voiceout = readFileSync('engine/voiceout.js', 'utf8')
const chain = String(pkg.scripts.test || '')

const v = versionsAligned()
ok('V172a все источники версии синхронизированы (version.ts, package.json, package-lock, VERSION.md)', v.ok, v.why)
ok('V172b README-история знает про 0.172 (в «Что нового» теперь одна запись)', /\*\*0\.172\*\*/.test(readme))
ok('V172c история 0.172 в README говорит про разговор вслух, перебить и озвучку — словами человека',
  /Разговор вслух/.test(readme) && /перебить/i.test(readme)
    && /озвучк/i.test(readme))

ok('V172d озвучка: адрес новой службы и параметр Ocp-Apim-Subscription-Key (старый закрыт)',
  /wss:\/\/api\.msedgeservices\.com\/tts\/cognitiveservices\/websocket\/v1/.test(voiceout)
    && !/['"]wss:\/\/speech\.platform/.test(voiceout)
    && /Ocp-Apim-Subscription-Key/.test(voiceout)
    && !/TrustedClientToken=/.test(voiceout))

ok('V172e сторож молчания заведён с осмысленным порогом и по звуку, а не по времени открытой сессии',
  /export const SILENT_DRAFT_SEC = 4/.test(voice)
    && /draftHeard\b/.test(voice)
    && /pcmLen >= SILENT_DRAFT_SEC \* WHISPER_RATE/.test(voice)
    && /peakOf\(samples\) >= SILENCE_PEAK/.test(voice))

ok('V172f сторож срабатывает ровно один раз и только если движок молчал (правило 0.150 в силе)',
  /if \(!draftFlip && !srDead && !draftGot && draftHeard/.test(voice)
    && /const serverLayers = \(\) => !Ctor \|\| srDead/.test(voice)
    && /rec\?\.abort\(\)/.test(voice)
    && /onServerLayers/.test(voice))

ok('V172g разговор вслух удалён целиком: ни состояния, ни памяти устройства, ни ручек',
  !/mt-talk/.test(chat) && !/talkRef/.test(chat) && !/setTalk\b/.test(chat)
    && !/talkArmedRef/.test(chat) && !/talkSendRef/.test(chat) && !/talkSentRef/.test(chat))

ok('V172h автостоп тишины теперь у ВСЕЙ диктовки, а не только разговора: 7 секунд покоя — микрофон сам закрылся',
  /VOICE_AUTO_MS = 7000/.test(chat)
    && /VOICE_LOUD = 0\.18/.test(chat)
    && !/TALK_SILENCE_MS/.test(chat)
    && /setInterval/.test(chat)
    && /stopVoiceInput\(\)/.test(chat))

ok('V172i микрофон снова просто микрофон: ни «перебить», ни разговорных состояний',
  !/Перебить и говорить/.test(chat)
    && !/talkSpeaking/.test(chat)
    && !/stopSpeech/.test(chat)
    && /if \(listening\) stopVoiceInput\(\)/.test(chat))

ok('V172j в меню «+» переключателя больше нет: пункт «Разговор вслух» удалён, остались действия',
  menu.indexOf('Разговор вслух') < 0
    && (menu.match(/role="menuitemcheckbox"/g) || []).length === 0
    && !/onToggleTalk/.test(menu)
    && /Камера/.test(menu) && /Файлы/.test(menu))

ok('V172k стили режима удалены вместе с режимом — в CSS нет ни переключателя, ни is-talk',
  !/talk-switch/.test(css) && !/voice-btn\.is-talk/.test(css) && !/talk-chip/.test(css))

ok('V172l новый тест подключён к цепочке прогона', /node test\/ui172\.test\.js/.test(chain))

ok('V172n пунктуация голосом: «точка» и друзья — знаки в поле, а не слова (браузерный черновик)',
  /const PUNCT/.test(voice)
    && /export function punctuate/.test(voice)
    && /punctuate\(\(r\[0\]\?\.transcript \|\| ''\)\.trim\(\)\)/.test(voice)
    && /точка\|период/.test(voice)
    && /новая строка/.test(voice))

ok('V172m автостоп молчит только в настоящую тишину: живая речь громче порога запись не гасит',
  /l > VOICE_LOUD/.test(chat)
    && /VOICE_AUTO_MS/.test(chat)
    && !/talkArmedRef/.test(chat))

console.log('\n' + '✔ 0.172 (правка 0.188): служба голоса и сторож на месте, разговора вслух нет, диктовка с автостопом и пунктуацией — проверки пройдены')
