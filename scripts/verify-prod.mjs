#!/usr/bin/env node
/**
 * Сверка прода с репозиторием — сторож от чужой выкладки.
 *
 * Зачем это нужно. Доступ к выкладке на metiger-ai.pages.dev есть у ключа
 * Cloudflare, и если этот ключ попадёт не в те руки, сайт можно незаметно заменить
 * на что угодно — фишинговую копию, чужой чат, страницу с рекламой. Заметить это
 * глазами трудно: копия выглядит так же.
 *
 * Чем ловится. Сборка проекта детерминирована: один и тот же исходник даёт ровно
 * те же имена файлов (index-<хеш>.js, хеш — от содержимого). Значит, сборку из
 * репозитория и то, что лежит на проде, можно сравнить по байтам.
 *
 * Как именно, и почему не «просто последние коммиты». Пока выкладка ручная, прод
 * законно отстаёт на десяток коммитов — и проверка «сходится ли прод с последними
 * шестью» орала бы на каждой невыложенной правке. Поэтому порядок такой:
 *
 *   1. с прода читается номер версии — он лежит в самой сборке (`const X="0.120"`);
 *   2. в истории main берутся только те коммиты, где версия была та же;
 *   3. их сборки сравниваются с продом по байтам.
 *
 * Коммитов с той же версией обычно единицы, поэтому проверка быстрая и не врёт:
 * отставание отличается от подмены, а не смешивается с ним.
 *
 * Вердикты:
 *   ✅ совпало с текущим main     — на проде наш код                     (код 0)
 *   🕓 совпало с прошлым коммитом main — прод отстаёт, это не тревога    (код 0)
 *   🌿 совпало с коммитом из другой ветки — выложили из рабочей ветки    (код 0)
 *   🚨 ни один коммит с этой версией не совпал — на проде чужая сборка   (код 1)
 *   ⚠️ сверить не удалось (сеть, сборка, прод старше окна истории)       (код 2)
 *
 * «Не удалось» и «подменили» — намеренно разные вещи: первое не повод кричать
 * о подмене, второе — не повод промолчать.
 *
 * Запуск:
 *   node scripts/verify-prod.mjs                 # обычная сверка
 *   node scripts/verify-prod.mjs --scan 200      # шире окно истории
 *   node scripts/verify-prod.mjs --build-max 8   # больше сборок-кандидатов
 *   node scripts/verify-prod.mjs --json          # машинный вывод
 *   node scripts/verify-prod.mjs --url https://… # сверить другой адрес
 *
 * Ключей не нужно никаких: прод читается обычным GET, сборки идут локально.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const arg = (name, def) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}
const URL_BASE = arg('--url', 'https://metiger-ai.pages.dev').replace(/\/+$/, '')
const SCAN = Math.max(1, parseInt(arg('--scan', '120'), 10) || 120)
const BUILD_MAX = Math.max(1, parseInt(arg('--build-max', '6'), 10) || 6)
const AS_JSON = argv.includes('--json')

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim()
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/**
 * Номер версии внутри собранного файла. Якорей два, и берётся старший из них:
 *   • `const Xx="0.120"` — сама APP_VERSION (её подставляет минификатор);
 *   • `{version:"0.120",title:"…"}` — записи «Что нового» (в них есть и прошлые
 *     версии, поэтому именно старшая = текущая сборки).
 * Старший, а не «первый попавшийся»: список новостей идёт от свежего к старому,
 * и у старой сборки в нём просто нет новых номеров — это и нужно.
 */
function versionOf(js) {
  const found = new Set()
  for (const re of [/const [A-Za-z_$][\w$]*="(0\.\d{3})"/g, /\{version:"(0\.\d{3})",title:"/g]) {
    for (const m of js.matchAll(re)) found.add(m[1])
  }
  const list = [...found].sort()
  return list.length ? list[list.length - 1] : ''
}

/** Имена файлов сборки, на которые ссылается index.html (входной JS и стили). */
function assetsOf(html) {
  const out = new Set()
  for (const m of html.matchAll(/assets\/[\w.-]+\.(?:js|css)/g)) out.add(m[0])
  return out
}

/** Что реально отдаёт живой адрес: версия, имена файлов и хеши их байтов. */
async function fetchProd() {
  const res = await fetch(`${URL_BASE}/?verify=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } })
  if (!res.ok) throw new Error(`прод ответил ${res.status}`)
  const html = await res.text()
  const assets = assetsOf(html)
  if (!assets.size) throw new Error('в index.html прода нет ссылок на assets/ — это не наша страница?')
  const hashes = {}
  let version = ''
  for (const a of assets) {
    const r = await fetch(`${URL_BASE}/${a}`, { headers: { 'cache-control': 'no-cache' } })
    if (!r.ok) throw new Error(`${a} отдался с кодом ${r.status}`)
    const body = Buffer.from(await r.arrayBuffer())
    hashes[a] = sha256(body)
    if (a.endsWith('.js') && !version) version = versionOf(body.toString('utf8'))
  }
  const title = (html.match(/<title>([^<]*)<\/title>/) || [, ''])[1]
  return { assets, hashes, version, title }
}

/** Номер версии в исходнике коммита. Пусто, если файла нет или он не читается. */
function versionAt(sha) {
  try {
    const src = git('show', `${sha}:src/lib/version.ts`)
    const m = src.match(/APP_VERSION\s*=\s*'([^']+)'/)
    return m ? m[1] : ''
  } catch {
    return ''
  }
}

/** Сборка одного коммита в отдельном каталоге. node_modules один на всех — ссылкой. */
function buildCommit(sha, work) {
  const dir = join(work, `wt-${sha.slice(0, 7)}`)
  const outDir = join(work, `out-${sha.slice(0, 7)}`)
  git('worktree', 'add', '--detach', '--force', dir, sha)
  try {
    const nm = join(ROOT, 'node_modules')
    if (existsSync(nm)) symlinkSync(nm, join(dir, 'node_modules'), 'dir')
    execFileSync(process.execPath, ['scripts/stamp-sw.mjs'], { cwd: dir, stdio: 'pipe' })
    execFileSync(join(ROOT, 'node_modules', '.bin', 'vite'), ['build', '--outDir', outDir, '--emptyOutDir'], {
      cwd: dir,
      stdio: 'pipe',
    })
    const html = readFileSync(join(outDir, 'index.html'), 'utf8')
    const assets = assetsOf(html)
    const hashes = {}
    for (const a of assets) hashes[a] = sha256(readFileSync(join(outDir, a)))
    return { assets, hashes }
  } finally {
    git('worktree', 'remove', '--force', dir)
  }
}

/** Прогресс. В режиме --json уходит в stderr: stdout должен быть чистым JSON,
 *  иначе машинный разбор ломается о первую же человеческую строку. */
const say = (s) => (AS_JSON ? console.error(s) : console.log(s))

const fingerprint = (o) => Object.keys(o.hashes).sort().map((a) => `${a}:${o.hashes[a]}`).join('|')

function report(verdict, prod, detail, extra = {}) {
  if (AS_JSON) {
    console.log(
      JSON.stringify(
        { verdict, url: URL_BASE, version: prod ? prod.version : '', assets: prod ? [...prod.assets] : [], detail, ...extra },
        null,
        2,
      ),
    )
    return
  }
  const line = { ok: '✅', behind: '🕓', other: '🌿', foreign: '🚨', warn: '⚠️' }[verdict] || '•'
  console.log(`${line} ${detail}`)
}

async function main() {
  const started = Date.now()
  say(`Сверка прода с репозиторием · ${URL_BASE}`)
  const prod = await fetchProd()
  const prodFp = fingerprint(prod)
  say(`  прод: версия ${prod.version || 'не прочиталась'}, файлы ${[...prod.assets].join(', ')}`)

  // Кандидаты — коммиты с той же версией, что на проде. Ищем по ВСЕМ веткам, а не
  // только по main: выкладка из рабочей ветки — обычное дело, и принимать её за
  // подмену нельзя (иначе сторож начнут игнорировать именно тогда, когда он нужен).
  const log = git('log', '--all', '--format=%H', '-n', String(SCAN)).split('\n').filter(Boolean)
  const sameVersion = prod.version ? log.filter((sha) => versionAt(sha) === prod.version) : []

  // Коммитов с версией прода не нашлось. Это «не знаю», а не «подменили»: прод
  // может быть старше окна, а версию могли собрать из ещё не закоммиченного
  // состояния. Говорим честно, что сверка не выполнена.
  if (prod.version && !sameVersion.length) {
    const headVer = versionAt('main')
    report(
      'warn',
      prod,
      `не нашлось коммитов с версией ${prod.version} среди ${log.length} последних во всех ветках (в main сейчас ${headVer || '—'}). ` +
        `Либо прод старше окна истории — тогда поможет --scan побольше, — либо версия собрана из незакоммиченного состояния. Сверка не выполнена.`,
      { commit: null, prodVersion: prod.version, headVersion: headVer, scanned: log.length },
    )
    process.exitCode = 2
    return
  }

  const candidates = sameVersion.length ? sameVersion : log
  say(
    sameVersion.length
      ? `  версия ${prod.version}: коммитов с ней ${sameVersion.length}, проверяю ${Math.min(candidates.length, BUILD_MAX)}`
      : '  версию прочитать не удалось — проверяю последние коммиты подряд',
  )

  const work = mkdtempSync(join(tmpdir(), 'metiger-verify-'))
  const tried = []
  try {
    for (const sha of candidates.slice(0, BUILD_MAX)) {
      let built
      try {
        built = buildCommit(sha, work)
      } catch (e) {
        tried.push({ sha, error: String(e.message || e).slice(0, 200) })
        continue
      }
      const subject = git('log', '-1', '--format=%s', sha).slice(0, 70)
      if (fingerprint(built) === prodFp) {
        // Совпало. Осталось сказать, насколько это «наше»: тот же ли это коммит,
        // что в main сейчас; если нет — отставание (нормально) или рабочая ветка.
        const head = git('rev-parse', 'main')
        let verdict = 'behind'
        let how = ''
        if (sha === head) {
          verdict = 'ok'
          how = 'ровно сборка текущего main'
        } else {
          const inMain = (() => {
            try {
              execFileSync('git', ['merge-base', '--is-ancestor', sha, 'main'], { cwd: ROOT, stdio: 'pipe' })
              return true
            } catch {
              return false
            }
          })()
          if (inMain) {
            how = `сборка более раннего коммита main (${sha.slice(0, 7)} «${subject}») — прод отстаёт, между правкой и выкладкой это нормально`
          } else {
            verdict = 'other'
            // Имя ветки: любые ссылки, а не только удалённые — локальная ветка тоже
            // законный источник выкладки, и назвать её надо так, как её зовёт человек.
            const holders = git('for-each-ref', '--contains', sha, '--format=%(refname:short)', 'refs/heads', 'refs/remotes')
              .split('\n')
              .map((r) => r.trim())
              .filter(Boolean)
            const branch = holders.find((r) => !/(^|\/)main$/.test(r)) || holders[0] || '(не названа)'
            how = `сборка из ветки ${branch} (${sha.slice(0, 7)} «${subject}»), в main её пока нет`
          }
        }
        report(verdict, prod, `прод — ${how}, версия ${prod.version}, байт в байт.`, {
          commit: sha,
          matches: sha,
          inMain: verdict !== 'other',
          behindBy: log.indexOf(sha),
          ms: Date.now() - started,
        })
        process.exitCode = 0
        return
      }
      tried.push({ sha, subject, fingerprint: fingerprint(built) })
    }

    // Собрали коммиты с этой версией — и ни один не совпал. Значит, сборка на
    // проде сделана не из этого репозитория: подмена либо чужая выкладка.
    const allChecked = sameVersion.length ? candidates.length <= BUILD_MAX : false
    report(
      allChecked ? 'foreign' : 'warn',
      prod,
      allChecked
        ? `СБОРКА НА ПРОДЕ НЕ ИЗ ЭТОГО РЕПОЗИТОРИЯ. Все ${tried.length} коммитов с версией ${prod.version} ` +
            `собраны и ни один не совпал с тем, что отдаёт ${URL_BASE}. Прод выложен не отсюда — либо из другого ` +
            `каталога/ветки, либо его заменили.`
        : `совпадений нет среди ${tried.length} собранных коммитов, но проверены не все (кандидатов ${candidates.length}). ` +
            `Повторите с --build-max ${Math.min(candidates.length, BUILD_MAX * 2)}. Сверка не завершена.`,
      { commit: null, prodVersion: prod.version, tried },
    )
    process.exitCode = allChecked ? 1 : 2
  } finally {
    try { rmSync(work, { recursive: true, force: true }) } catch {}
  }
}

main().catch((e) => {
  report('warn', null, `проверить не удалось: ${String(e.message || e)}`, { commit: null, tried: [] })
  process.exitCode = 2
})
