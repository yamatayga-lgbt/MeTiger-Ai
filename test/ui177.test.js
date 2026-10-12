/**
 * 0.177 «Картинка доходит»: канал без ключей, токен как запасной и честный прогресс.
 *
 * Просьба владельца: «Картинка должна доходить» — раньше на заказе рисования
 * человек читал «у бесплатных источников кончился лимит на сегодня». Решение:
 * третий (по счёту — первый) канал Cloudflare Workers AI по привязке `AI`, для
 * которого не нужен ни один токен, плюс токен Pollinations, если владелец его
 * всё-таки пришлёт, и честный прогресс: видно, что агент рисует и перебирает
 * каналы, а не висит.
 *
 * Здесь стерегутся именно обещания: канал действительно без ключей, он первым
 * берётся за дело, отказ виден словами, а имя провайдера наружу (в пузырь и в
 * прогресс) не протекает. Полное поведение слоя проверяет test/imggen.test.js
 * (секция K), дорогу целиком — test/imgstream.test.js.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { versionsAligned } from './version-sync.js'

const ok = (name, condition, extra) => {
  assert.ok(condition, name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  console.log('  ✔ ' + name)
}

const read = (p) => readFileSync(p, 'utf8')
const notes = read('src/lib/release-notes.ts')
const readme = read('README.md')
const pkg = JSON.parse(read('package.json'))
const wrangler = read('wrangler.toml')
const sw = read('public/sw.js')
const imggen = read('engine/imggen.js')
const engineChat = read('engine/chat.js')
const door = read('functions/api/chat.js')
const api = read('src/lib/api.ts')
const view = read('src/views/ChatView.tsx')
const app = read('src/App.tsx')
const css = read('src/styles/index.css')

/* Комментарии вон: в пояснениях «почему так» стоят те же имена, и проверки
   «этого нет» ловили бы текст, а не код (тот же приём, что в U176). */
const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const v = versionsAligned()
ok('U177a все источники версии синхронизированы', v.ok, v.why)

/* Версия кэша оболочки — из version.ts, а не литералом: U177c проверял «v0177»,
   и выпуск 0.178 уронил бы проверку 0.177 на ровном месте (тот же урок, что у
   versionsAligned). Kэш обязан знать ТЕКУЩУЮ версию — иначе телефон отдаёт
   старую оболочку. */
const appVer = (read('src/lib/version.ts').match(/APP_VERSION = '([^']+)'/) || [])[1] || ''
const swVer = 'v' + appVer.replace(/\./g, '')
ok('U177b «Что нового» и README знают 0.177',
  /version: '0\.177'/.test(notes) && /\*\*0\.177\*\*/.test(readme))
ok('U177c запись говорит человеку про картинки, а не про внутренности',
  /картин/i.test(notes) && !/эндпоинт|env\.AI|binding/.test(notes) && sw.includes(swVer))

ok('U177d привязка AI включена в wrangler — картинки без единого токена',
  /\[ai\]/.test(wrangler) && /binding = "AI"/.test(wrangler)
    /* Пустая секция [env] production = {} перекрыла бы верхний уровень: правило 0.16x. */
    && !/^\s*\[env\]\s*$/m.test(wrangler))

ok('U177e новый канал — Workers AI: flux-1-schnell, base64 и предел шагов',
  /workersAiSource/.test(imggen) && /@cf\/black-forest-labs\/flux-1-schnell/.test(imggen)
    && /env\.AI/.test(imggen) && /Math\.min\(8,/.test(imggen)
    && /edits: false/.test(imggen))

ok('U177f канал идёт первым: он не зависит от чужих лимитов и ключей',
  /builders = \[workersAiSource, geminiSource, odirouterSource/.test(imggen))

ok('U177g токен Pollinations подхватывается, но картинка не зависит от него',
  /POLLINATIONS_TOKEN/.test(imggen) && /Bearer ' \+ token/.test(imggen)
    && /401 \|\| r\.status === 403/.test(imggen))

ok('U177h прогресс рисования уезжает в поток тем же путём, что куски текста',
  /kind: 'image'/.test(engineChat) && /kind === 'image'/.test(door)
    && /onImageSteps/.test(api) && /export interface ImageStep/.test(api)
    /* Дверь кладёт этап в `step`, клиент обязан читать именно его: расхождение
       имён уже один раз молча выключило прогресс на проде. */
    && /context\.__send\(\{ kind: 'image', step: ev\.step \}\)/.test(door)
    && /ev\.img \|\| ev\.step/.test(api))

ok('U177i человек видит «рисую… канал N из M», и это только во время работы',
  /ImageProgressBlock/.test(view) && /draftImgSteps/.test(view)
    /* Прогресс живёт в черновике и не попадает в готовое сообщение: */
    && !/ImageProgressBlock steps=\{m\./.test(view)
    && /Channel \{x\.index \|\| idx \+ 1\} of \{x\.total \|\| total\}/.test(view))

ok('U177j имя провайдера наружу не протекает — в прогрессе только номер канала',
  !/\{x\.channel\}/.test(bare(view)) && !/x\.channel/.test(bare(view))
    && !/gemini|odirouter|workersai|pollinations/i.test(bare(view)))

ok('U177k заказ и правка не путаются: «Editing» — по просьбе человека, а не по каналу',
  /x\.state === 'start' && x\.edit/.test(view))

ok('U177l стили прогресса — переменными темы, без новых единиц экрана',
  /\.img-prog-head \{/.test(css) && /\.img-prog-row \{/.test(css) && /\.img-prog-steps \{/.test(css)
    && /var\(--text\)/.test(css.slice(css.indexOf('.img-prog-head'))) && !/100dvh/.test(bare(css)))

ok('U177m тесты подключены к прогону, а прежние сторожа живы',
  /node test\/imgstream\.test\.js/.test(String(pkg.scripts.test))
    && /node test\/ui177\.test\.js/.test(String(pkg.scripts.test))
    && /imggen\.test\.js/.test(String(pkg.scripts.test)))

ok('U177n отказ канала назван словами и парковка не превращается в «висит»',
  /state: 'failed'/.test(imggen) && /state: 'trying'/.test(imggen)
    && /честный прогресс/i.test(imggen))

ok('U177p черновик не показывает служебный блок заказа картинки',
  /hideServiceBlocks/.test(view)
    /* черновик печатается через эту же функцию, а не сырым текстом потока */
    && /\{hideServiceBlocks\(draft\)\}/.test(view)
    /* и хвост блока, который ещё не закрылся, тоже прячется */
    && /не закрыт/.test(view))

ok('U177q одно устройство — одна запись: визит несёт отпечаток, сервер по нему узнаёт телефон',
  /fingerprintOf/.test(read('engine/devid.js')) && /fpIndexKey/.test(read('engine/devid.js'))
    && /fpIndexKey\(fp\)/.test(read('functions/api/device.js'))
    && /deviceFp/.test(read('src/lib/devid.ts')) && /fp: await deviceFp\(\)/.test(read('src/lib/devid.ts')))

ok('U177r дверь профиля не делает вторую дверь в обращения (просьба владельца)',
  !/label="Обращения"/.test(read('src/views/ProfileView.tsx'))
    && /Обращения/.test(read('src/views/AdminView.tsx')))

ok('U177o общий слой картинок сбрасывается для тестов (иначе env изолята решает за всех)',
  /export function forgetSharedImggen/.test(imggen))

console.log('\n✔ 0.177: картинка доходит — проверки пройдены')
