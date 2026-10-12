/**
 * 0.172: разговор вслух и починка голоса.
 *
 * Две половины голоса сломались 12 окт 2026 по одной общей причине — молчание.
 * Озвучка: служба Microsoft закрыла старый адрес (403), и это видно не в логах, а
 * в ответе /api/tts «служба голоса не дала соединения». Ввод: у движка браузера
 * есть третье состояние — «принял и молчит», и серверные слои включались только
 * после явной ошибки, поэтому человек видел «Слушаю» и пустое поле.
 *
 * Проверки здесь держат именно это: новый адрес службы и имя параметра ключа,
 * сторож молчания (и то, что правило 0.150 «живой движок — финал» не сломано),
 * режим разговора целиком (переключатель, чип, автоотправка, перебить) — и всё
 * это без сети: живое поведение проверено пробами, тут закреплены обещания кода.
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
ok('V172b «Что нового» и README знают про 0.172', /version: '0\.172'/.test(notes) && /\*\*0\.172\*\*/.test(readme))
ok('V172c запись 0.172 говорит про разговор вслух, ввод и озвучку — словами человека',
  /Разговор вслух/.test(notes) && /перебить/i.test(notes)
    && /озвучк/i.test(notes) && /голосовой ввод/i.test(notes))

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

ok('V172g разговор вслух: режим помнится устройством и виден человеку строкой над полем',
  /localStorage\.getItem\('mt-talk'\)/.test(chat)
    && /localStorage\.setItem\('mt-talk'/.test(chat)
    && /className="talk-chip"/.test(chat)
    && /Разговор вслух · слушаю/.test(chat))

ok('V172h разговор вслух: ход закрывается сам, а отправка ждёт точный текст, а не пустое поле',
  /TALK_SILENCE_MS/.test(chat)
    && /stopVoiceInput\(\)/.test(chat)
    && /talkSendRef\.current = true/.test(chat)
    && /if \(talkSendRef\.current && talkRef\.current\)/.test(chat)
    && /submit\(composed\)/.test(chat)
    && /talkRef\.current && !sessionRef\.current\) startVoiceInput\(\)/.test(chat))

ok('V172i пока агент говорит, микрофон — «перебить»: одно касание замолкает и слушает',
  /if \(talkSpeaking\) \{/.test(chat)
    && /stopSpeech\(\)/.test(chat)
    && /Перебить и говорить/.test(chat)
    && /setTalkSpeaking\(false\)/.test(chat))

ok('V172j переключатель живёт в меню «+» и назван человеку «Разговор вслух»',
  /Разговор вслух/.test(menu)
    && /role="menuitemcheckbox"/.test(menu)
    && /aria-checked=\{talk\}/.test(menu)
    && /onToggleTalk/.test(menu))

ok('V172k стили режима — переменными темы, а не красным и не чужими константами',
  /\.talk-chip \{/.test(css) && /\.talk-switch \{/.test(css)
    && /color: var\(--accent\)/.test(css.slice(css.indexOf('.talk-chip {'), css.indexOf('.talk-chip {') + 600))
    && !/#[0-9a-fA-F]{3,6}/.test(css.slice(css.indexOf('.talk-chip {'), css.indexOf('.talk-chip {') + 1200)))

ok('V172l новый тест подключён к цепочке прогона', /node test\/ui172\.test\.js/.test(chain))

ok('V172m включение режима не читает прошлую переписку — вслух звучит только новое',
  /talkArmedRef/.test(chat)
    && /last\.ts < talkArmedRef\.current\)\)\s*return/.test(chat)
    && /talkArmedRef\.current = next \? Date\.now\(\) : 0/.test(chat))

console.log('\n' + '✔ 0.172: разговор вслух и починка голоса — проверки пройдены')
