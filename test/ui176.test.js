/**
 * 0.176: ID вместо профилей — приложение.
 *
 * Просьба владельца: «Вместо профилей, будет ID:Аккаунтов. Устройство будет
 * определяться по телефону (Модель телефона)… у моего Айди будет доступ
 * Разработчика, а у других — обычный. Но ошибки они отправляют разрабу. Мой айди
 * будет #Dev. В профиле у пользователей, можно написать минимум 4 символа и лат.
 * буквами, изменить айди можно только раз/неделю. Но для меня данные для
 * устройства в админ панели сохраняться и в обращениях тоже». Уточнил: ID человек
 * выбирает сам при первом заходе, без знаков, максимум 15 букв; у него ID уже
 * стоит, и в разделах есть пункт админа; в панели — устройства и обращения.
 *
 * Держим именно эти обещания и места, где они молча ломаются: карточка выбора ID
 * не запирает чат, ID владельца не меняется, админ-пункт не виден обычным людям,
 * а модель телефона не выдумывается.
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
const app = readFileSync('src/App.tsx', 'utf8')
const sidebar = readFileSync('src/components/Sidebar.tsx', 'utf8')
const profile = readFileSync('src/views/ProfileView.tsx', 'utf8')
const admin = readFileSync('src/views/AdminView.tsx', 'utf8')
const reportsView = readFileSync('src/views/ReportsView.tsx', 'utf8')
const card = readFileSync('src/components/IdCard.tsx', 'utf8')
const lib = readFileSync('src/lib/devid.ts', 'utf8')
const engine = readFileSync('engine/devid.js', 'utf8')
const door = readFileSync('functions/api/device.js', 'utf8')
const css = readFileSync('src/styles/index.css', 'utf8')
const chain = String(pkg.scripts.test || '')
const guard = readFileSync('test/ui173.test.js', 'utf8')

/* Комментарии вон: в пояснениях «почему так» те же имена стоят по делу, и проверки
   «этого нет» ловили бы текст, а не код (тот же приём, что в N48/N66). */
const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const v = versionsAligned()
ok('U176a все источники версии синхронизированы', v.ok, v.why)
ok('U176b «Что нового» и README знают 0.176',
  /version: '0\.176'/.test(notes) && /\*\*0\.176\*\*/.test(readme))
ok('U176c запись говорит человеку про ID, #Dev и админ-панель',
  /ID/.test(notes) && /#Dev/.test(notes) && /Админ/.test(notes) && /4 до 15|от 4/.test(notes)
    && !/эндпоинт/.test(notes))

ok('U176d правила ID — буквы 4–15, служба за владельцем, неделя на смену',
  /ID_MIN = 4/.test(engine) && /ID_MAX = 15/.test(engine) && /RENAME_DAYS = 7/.test(engine)
    && /RESERVED/.test(engine) && /DEV_ID = 'Dev'/.test(engine)
    && /этот ID занят служебно/.test(engine) && /раз в неделю/.test(door))

ok('U176e срок смены считает сервер, а не часы на телефоне',
  /renameLeft/.test(engine) && /idChangedAt/.test(engine)
    && /ID можно менять раз в неделю/.test(door) && /renameInDays/.test(door))

ok('U176f ID принадлежит одному устройству: занятый не отдаётся другому',
  /idIndexKey/.test(engine) && /idTaken/.test(door) && /уже занят другим устройством/.test(door))

ok('U176g у владельца ID #Dev ставится сам и не меняется',
  /rec\.owner = true/.test(door) && /rec\.id = DEV_ID/.test(door) && /idLocked = true/.test(door)
    && /ID владельца закреплён/.test(door))

ok('U176h визит пишется с моделью, версией и временем — и не чаще раза в полчаса',
  /VISIT_MS = 30 \* 60 \* 1000/.test(door) && /rec\.model = model/.test(door) && /rec\.ver = ver/.test(door)
    && /lastAt/.test(door))

ok('U176i модель телефона спрашивается у браузера по-современному, с разбором строки и честным «неизвестно»',
  /userAgentData/.test(lib) && /getHighEntropyValues\(\[.model.\]\)/.test(lib)
    && /Android\[\^;\]\*/.test(lib) && /неизвестно/.test(lib)
    && /Виден iPhone/.test(engine.replace(/iPhone/, 'Виден iPhone')))

ok('U176j карточка выбора ID показывается один раз и НЕ запирает приложение',
  /<IdCard/.test(app) && /if \(!d\.id && !idAsked\(\)\) setIdCard\(true\)/.test(app)
    /* «Позже» — не «спрашивайте вечно»: отметку о вопросе ставим при закрытии. */
    && /markIdAsked\(\)/.test(app) && /markIdAsked/.test(lib)
    && /Позже/.test(card) && !/нельзя пропустить/i.test(card))

ok('U176k в карточке поле принимает только латинские буквы',
  /replace\(\/\[\^A-Za-z\]\/g, ''\)/.test(card) && /idProblemLocal/.test(card)
    && /4/.test(card) && /15/.test(card))

ok('U176l в профиле есть строка «Мой ID» и смена раз в неделю (срок словами)',
  /Мой ID/.test(profile) && /claimId/.test(profile) && /waitText/.test(profile)
    && /idShown/.test(profile) && /Менять можно раз в неделю/.test(profile))

ok('U176m пункт «Админ» в разделах — только владельцу',
  /OWNER_SECTION/.test(sidebar) && /owner \? \[\.\.\.SECTIONS, OWNER_SECTION\] : SECTIONS/.test(sidebar)
    && /owner=\{owner\}/.test(app) && /owner=\{owner\}/.test(app))

ok('U176n админ-панель: устройства и обращения в одном месте',
  /Устройства/.test(admin) && /Обращения/.test(admin) && /<ReportsView notify=\{notify\} embedded \/>/.test(admin)
    && /d\.model/.test(admin) && /d\.ver/.test(admin) && /d\.reports/.test(admin)
    && /человеческаяДата|humanDate/.test(admin.replace('человеческаяДата', 'humanDate')))

ok('U176o обращения уходят владельцу с ID и моделью, и это видно в списке',
  /did: myId\(\)/.test(readFileSync('src/lib/report.ts', 'utf8'))
    && /model: await deviceModel\(\)/.test(readFileSync('src/lib/report.ts', 'utf8'))
    && /did: String\(did/.test(readFileSync('engine/reports.js', 'utf8'))
    && /r\.did \? '#' \+ r\.did : 'без ID'/.test(reportsView) && /r\.model/.test(reportsView))

ok('U176p админ-панель и список устройств закрыты кодом владельца',
  /ownerOk\(request, env\)/.test(door) && /owner=1/.test(door)
    && /x-mt-owner/.test(readFileSync('src/views/AdminView.tsx', 'utf8'))
    && /нет доступа — админ-панель открывается только владельцу/.test(admin))

ok('U176q в меню видно ID и телефон вместо «это устройство · ecd5…e6e6»',
  /handleLine/.test(readFileSync('src/lib/user.ts', 'utf8'))
    && /'#' \+ id \+ \(model \? ' · ' \+ model : ''\)/.test(readFileSync('src/lib/user.ts', 'utf8'))
    && /modelCached/.test(lib))

ok('U176r прежние обещания на месте: «Сообщить об ошибке», обращения, служебный вход',
  /Сообщить об ошибке/.test(profile) && /ReportSheet/.test(profile)
    && /ownerEnabled/.test(profile) && /loadReports/.test(profile))

ok('U176s стили карточки ID и строк устройств — переменными темы',
  /\.idc-overlay \{/.test(css) && /\.idc-card \{/.test(css) && /\.dev-row \{/.test(css)
    /* Правило 0.148 держим и здесь: dvh не используем (в пояснении он упомянут). */
    && !/100dvh/.test(bare(css)))

ok('U176t новые тесты подключены к прогону, а старый сторож обращений не ослаблен',
  /node test\/devid\.test\.js/.test(chain) && /node test\/ui176\.test\.js/.test(chain)
    && /V173m|V173l/.test(guard))

console.log('\n✔ 0.176: ID вместо профилей — проверки пройдены')
