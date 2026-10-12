/**
 * 0.174: аккаунты — приложение.
 *
 * Владелец попросил: вход и регистрация (основа — Google, рядом TikTok, Instagram,
 * VK, Discord, Facebook), восстановление пароля письмом, максимум пять аккаунтов,
 * память на аккаунтах — и всё это «без всякого кода» (служебный вход из 0.173
 * должен уйти совсем).
 *
 * Проверки держат именно эти обещания и места, где они тихо ломаются: ворота входа
 * (без аккаунта в чат не попасть), разведение переписок по полкам аккаунтов,
 * отсутствие кода владельца в интерфейсе, «честность» кнопок сетей (нет ключа —
 * не обещаем) и восстановление через письмо с новым паролем.
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
const auth = readFileSync('src/lib/auth.ts', 'utf8')
const view = readFileSync('src/views/AuthView.tsx', 'utf8')
const profile = readFileSync('src/views/ProfileView.tsx', 'utf8')
const info = readFileSync('src/views/InfoView.tsx', 'utf8')
const report = readFileSync('src/lib/report.ts', 'utf8')
const persist = readFileSync('src/lib/persist.ts', 'utf8')
const css = readFileSync('src/styles/index.css', 'utf8')
const endpoint = readFileSync('functions/api/auth.js', 'utf8')
const engine = readFileSync('engine/accounts.js', 'utf8')
const mailer = readFileSync('engine/mailer.js', 'utf8')
const chain = String(pkg.scripts.test || '')

/* Комментарии вырезаем: в пояснениях «почему убрали» те же имена стоят по делу,
   и проверки «этого нет» ловили бы текст, а не код. Приём тот же, что в N48/N66. */
const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '')

const v = versionsAligned()
ok('U174a все источники версии синхронизированы (version.ts, package.json, package-lock, VERSION.md)', v.ok, v.why)
ok('U174b «Что нового» и README знают про 0.174',
  /version: '0\.174'/.test(notes) && /\*\*0\.174\*\*/.test(readme))
ok('U174c запись 0.174 говорит человеку про аккаунт, память и пять аккаунтов',
  /Аккаунт/i.test(notes) && /память/i.test(notes) && /пяти аккаунтов|5 аккаунтов/.test(notes)
    && /Google/.test(notes) && !/эндпоинт/.test(notes))

ok('U174d без входа в приложение не попасть: показывается экран входа, а не чат',
  /if \(!account\) \{/.test(app) && /<AuthView/.test(app)
    && /void accountMe\(\)/.test(app) && /if \(!booted\)/.test(app))

ok('U174e переписки читаются и пишутся только после того, как известен аккаунт',
  /if \(!account \|\| !booted\) return/.test(app)
    && /setStorageScope\(account\.id\)/.test(app))

ok('U174f полки переписок разведены по аккаунтам, старые записи переходят при первом входе',
  /export function setStorageScope/.test(persist) && /const keyOf = \(base: string\) => base \+ scope/.test(persist)
    /* Идентификатор берём целиком: обрезка до 12 знаков сближала бы разные аккаунты. */
    && !/slice\(0, 12\)/.test(persist)
    && /const own = localStorage\.getItem\(keyOf\(CHATS_KEY\)\)/.test(persist)
    && /own \|\| \(scope \? localStorage\.getItem\(CHATS_KEY\) : null\)/.test(persist))

ok('U174g вход и регистрация — две роли одного экрана, с живой подсказкой',
  /mode === 'login'/.test(view) && /mode === 'register'/.test(view)
    && /registerAccount/.test(view) && /loginAccount/.test(view)
    && /Почта нужна, чтобы вернуть доступ/.test(view))

ok('U174h кнопки сетей: Google первым, шесть входов, выключенные честно помечены',
  /PROVIDER_ORDER = \['google', 'vk', 'discord', 'facebook', 'instagram', 'tiktok'\]/.test(view)
    && /auth-prov-soon/.test(view) && /authOptions\(\)/.test(view)
    && /startProvider/.test(auth) && /'\/api\/auth\?start='/.test(auth))

ok('U174i вход включается ключами на сервере — выдуманных кнопок нет',
  /enabledProviders/.test(engine) && /keys: \['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'\]/.test(engine)
    && /providers: enabledProviders\(env\)/.test(endpoint))

ok('U174j «забыли пароль» присылает НОВЫЙ пароль письмом, а не ссылку-выдумку',
  /Забыли пароль\?/.test(view) && /recoverPassword/.test(view)
    && /newPasswordLetter/.test(mailer) && /Новый пароль: /.test(mailer)
    && /action === 'recover'/.test(endpoint) && /newPassword\(\)/.test(endpoint))

ok('U174k без почтового ключа сказано честно, что почта не подключена',
  /mailConfigured\(env\)/.test(endpoint) && /почта ещё не подключена/.test(endpoint)
    && /mail: mailConfigured\(env\)/.test(endpoint))

ok('U174l пароль нельзя прочитать из хранилища — производная с солью',
  /PBKDF2/.test(engine) && /hashPassword/.test(engine) && /verifyPassword/.test(engine)
    && /crypto\.getRandomValues\(saltBytes\)/.test(engine) && /120_000/.test(engine))

ok('U174m пять аккаунтов — потолок сервера, а не надпись',
  /ACCOUNTS_PER_DEVICE = 5/.test(engine) && /deviceProblem/.test(engine)
    && /deviceProblem\(dev\.rec, env\)/.test(endpoint))

ok('U174n память, профиль и обращения привязаны к аккаунту',
  /memoryOwner/.test(readFileSync('functions/api/chat.js', 'utf8'))
    && /sessionUser\(request, env\)/.test(readFileSync('functions/api/profile.js', 'utf8'))
    && /isOwnerAccount/.test(readFileSync('functions/api/report.js', 'utf8')))

ok('U174o кода владельца в интерфейсе больше нет — «без всякого кода»',
  !/Служебный вход/.test(bare(info)) && !/ownerEnabled/.test(bare(profile))
    && !/checkOwnerCode/.test(bare(report)) && !/x-mt-owner/.test(bare(report))
    && /account\?\.owner/.test(profile))

ok('U174p профиль показывает аккаунт: почту, смену пароля и выход',
  /account\?\.email/.test(profile) && /changePassword/.test(profile)
    && /Выйти из аккаунта/.test(profile) && /onSignOut/.test(profile))

ok('U174q печенька сессии — httpOnly, Secure на https, и в localStorage токена нет',
  /HttpOnly/.test(endpoint) && /SameSite=Lax/.test(endpoint)
    /* Secure ставится по схеме запроса: на проде это всегда https, а на локальной
       проверке (стенд на http://127.0.0.1) с ним браузер печеньку не сохранял, и
       «вошёл» локально не наступало — поймано пробой accounts-test. */
    && /protocol === 'https:'/.test(endpoint) && /SESSION_TTL_SEC/.test(endpoint)
    && /setCachedAccount/.test(auth) && /(?:доступа он не даёт|не документ доступа|только для показа)/i.test(auth))

ok('U174r добавленное не сломало прежние обещания: «Разговор вслух» и форма ошибок на месте',
  /talk-chip/.test(readFileSync('src/views/ChatView.tsx', 'utf8'))
    && /Сообщить об ошибке/.test(profile) && /ReportSheet/.test(profile))

ok('U174s стили экрана входа — переменными темы',
  /\.auth-screen \{/.test(css) && /\.auth-card \{/.test(css) && /\.auth-prov \{/.test(css)
    && /var\(--accent-grad\)/.test(css.slice(css.indexOf('.auth-logo {'))))

ok('U174t новые тесты подключены к цепочке прогона',
  /node test\/auth\.test\.js/.test(chain) && /node test\/ui174\.test\.js/.test(chain))

console.log('\n✔ 0.174: аккаунты — проверки пройдены')
