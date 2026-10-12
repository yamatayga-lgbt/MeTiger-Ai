/**
 * 0.173: «Сообщить об ошибке» — приложение.
 *
 * Владелец просил три вещи, и все три проверяются здесь текстом, а не глазами:
 *   · «Рабочая область» из профиля убрана;
 *   · у пункта «Сообщить об ошибке» появилось окошко — описание и до четырёх фото;
 *   · у владельца на ЕГО устройстве появляется служебная кнопка, невидимая другим,
 *     и обращения с двумя кнопками: «Рассмотрено» или «Отказано».
 *
 * Отдельно закреплено то, чего быть НЕ должно: переключателя «встряхните телефон»
 * владелец вычеркнул красным на приложенном снимке — детектора тряски в коде нет.
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
const profile = readFileSync('src/views/ProfileView.tsx', 'utf8')
const sheet = readFileSync('src/components/ReportSheet.tsx', 'utf8')
const reportsView = readFileSync('src/views/ReportsView.tsx', 'utf8')
const info = readFileSync('src/views/InfoView.tsx', 'utf8')
const app = readFileSync('src/App.tsx', 'utf8')
const lib = readFileSync('src/lib/report.ts', 'utf8')
const css = readFileSync('src/styles/index.css', 'utf8')
const endpoint = readFileSync('functions/api/report.js', 'utf8')
const engine = readFileSync('engine/reports.js', 'utf8')
const chain = String(pkg.scripts.test || '')

const v = versionsAligned()
ok('V173a все источники версии синхронизированы (version.ts, package.json, package-lock, VERSION.md)', v.ok, v.why)
ok('V173b «Что нового» и README знают про 0.173',
  /version: '0\.173'/.test(notes) && /\*\*0\.173\*\*/.test(readme))
ok('V173c запись 0.173 говорит человеку про форму, фото и владельца — без слов вроде «эндпоинт»',
  /Сообщить об ошибке/.test(notes) && /четырёх снимков|четырёх фото/.test(notes)
    && /Рассмотрено/.test(notes) && /Отказано/.test(notes) && !/эндпоинт/.test(notes))

ok('V173d «Рабочая область» из профиля убрана — и строки, и ручки',
  /* Комментарии вырезаем: в пояснении «почему убрали» это имя стоит по делу, и
     проверка по всему файлу ловила бы текст, а не список строк (тот же приём в
     N48/N66 из test/front.test.js). */
  !/Рабочая область/.test(profile.replace(/\/\*[\s\S]*?\*\//g, '')) && !/Briefcase/.test(profile))

ok('V173e «Сообщить об ошибке» стало живым: не «Скоро», а открывает форму',
  /aria-label="Сообщить об ошибке"/.test(profile)
    && /setReportOpen\(true\)/.test(profile)
    && !/rows-row is-soon[\s\S]{0,220}Сообщить об ошибке/.test(profile)
    && /<ReportSheet onClose=/.test(profile))

ok('V173f форма принимает описание до 2000 знаков и до четырёх фото — как просил владелец',
  /Что произошло\?/.test(sheet) && /REPORT_MAX_CHARS/.test(sheet) && /maxLength=\{REPORT_MAX_CHARS\}/.test(sheet)
    && /REPORT_MAX_PHOTOS/.test(sheet) && /Снимков: \{photos\.length\} из \{REPORT_MAX_PHOTOS\}/.test(sheet))

ok('V173g форма отправляет к владельцу сама — без почтовых клиентов и «скопируйте адрес»',
  /sendReport\(/.test(sheet) && /async function sendReport|export async function sendReport/.test(lib)
    && /fetch\('\/api\/report'/.test(lib) && /Отправлено — спасибо/.test(sheet))

ok('V173h к отчёту уходят версия и анонимный ключ устройства, а про переписку честно сказано',
  /ver: APP_VERSION/.test(lib) && /uid: ensureDeviceUserId\(\)/.test(lib)
    && /Переписка и ваши файлы не отправляются/.test(sheet))

ok('V173i «встряхните телефон» нет: детектора тряски в коде не появилось (владелец вычеркнул)',
  /* Тут тоже без комментариев: в пояснении прямо сказано, чего нет, и по тексту
     пояснения проверка срабатывала бы наоборот. */
  !/devicemotion|shake|тряхн/i.test(sheet.replace(/\/\*[\s\S]*?\*\//g, ''))
    && !/devicemotion|shake|тряхн/i.test(lib.replace(/\/\*[\s\S]*?\*\//g, '')))

ok('V173j служебная кнопка владельца спрятана: пять тапов по версии в «Информации»',
  /OWNER_TAPS = 5/.test(info) && /tapVersion/.test(info) && /onPointerDown=\{tapVersion\}/.test(info)
    && /checkOwnerCode/.test(info) && /setOwnerCode\(/.test(info))

ok('V173k карточка «Ведомство» появляется только там, где введён код владельца',
  /ownerEnabled\(\)/.test(profile) && /\{owner \? \(/.test(profile)
    && /Ведомство/.test(profile) && /label="Обращения"/.test(profile) && /onNavigate\('reports'\)/.test(profile))

ok('V173l у каждой заявки две кнопки — «Рассмотрено» и «Отказано», и обе живые',
  /Рассмотрено/.test(reportsView) && /Отказано/.test(reportsView)
    && /verdict\(r\.id, 'done'\)/.test(reportsView) && /verdict\(r\.id, 'declined'\)/.test(reportsView)
    && /setReportVerdict/.test(lib))

ok('V173m обращения уходят и приходят через свой вход, и на сервере он под замком',
  /'\/api\/report\?owner=1'/.test(lib) && /x-mt-owner/.test(lib)
    && /x-mt-owner/.test(endpoint) && /isOwnerCode\(/.test(endpoint)
    /* Правила приёма живут в engine/reports.js — там же, где их проверяет тест. */
    && /не больше \$\{REPORT_LIMITS\.MAX_PHOTOS\}/.test(engine)
    && /MAX_CHARS: 2000/.test(engine))

ok('V173n экран «Обращения» подключён к приложению как настоящий маршрут',
  /'reports'/.test(app) && /reports: 'Обращения'/.test(app)
    && /ReportsView/.test(app) && /reports: 'profile'/.test(app))

ok('V173o статус «Отказано» нарисован тихо (серым), а не красным — как договаривались о цвете',
  /\.rep-status\.is-declined \{[^}]*--text-3/.test(css.replace(/\n/g, ' '))
    && !/\.rep-status\.is-declined \{[^}]*--danger/.test(css.replace(/\n/g, ' ')))

ok('V173p стили обращений — переменными темы, без чужих констант',
  /\.rep-sheet \{/.test(css) && /\.rep-card \{/.test(css) && /\.owner-input \{/.test(css)
    && /var\(--accent-grad\)/.test(css.slice(css.indexOf('.rep-send {'))))

ok('V173r окна живут порталом, а шапка шторки — липкая (иначе окно уезжает за экран)',
  /* Поймано живой пробой: родитель — анимированный список, у него есть transform,
     и обычный position: fixed привязался к нему, а не к окну браузера. У длинного
     списка шторка оказывалась выше экрана, и крестик был недосягаем. */
  /createPortal\(sheet, document\.body\)/.test(sheet)
    && /createPortal\(/.test(reportsView) && /document\.body,/.test(reportsView)
    && /\.rep-head \{[^}]*position: sticky/.test(css.replace(/\n/g, ' ')))

ok('V173q новые тесты подключены к цепочке прогона',
  /node test\/report\.test\.js/.test(chain) && /node test\/ui173\.test\.js/.test(chain))

console.log('\n✔ 0.173: обращения об ошибках — проверки пройдены')
