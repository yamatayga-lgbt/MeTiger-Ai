#!/usr/bin/env node
/**
 * Сверка прода с репозиторием — сторож от чужой выкладки.
 *
 * Зачем это нужно. Доступ к выкладке на metiger-ai.pages.dev есть у токена
 * Cloudflare, и если этот токен когда-нибудь попадёт не в те руки, сайт можно
 * незаметно заменить на что угодно — фишинговую копию, чужой чат, страницу
 * с рекламой. Заметить это глазами трудно: внешне копия выглядит так же.
 *
 * Чем ловится. Сборка проекта детерминирована: один и тот же исходник даёт
 * ровно те же имена файлов (index-<хеш>.js), потому что имя — это хеш содержимого.
 * Значит, сборка из репозитория и то, что лежит на проде, сравнимы по байтам:
 *
 *   • файлы на проде побайтово равны сборке коммита N из main → на проде наш код;
 *   • равны сборке более старого коммита → прод просто отстаёт (это не тревога,
 *     так бывает между правкой и выкладкой);
 *   • не равны ни одному из последних коммитов → НА ПРОДЕ ЧУЖАЯ СБОРКА.
 *
 * Третий случай — единственная настоящая тревога, и о нём сторожа и заводят.
 *
 * Запуск:
 *   node scripts/verify-prod.mjs                  # сверить с последними 6 коммитами
 *   node scripts/verify-prod.mjs --commits 3      # быстрее, для проверки на ходу
 *   node scripts/verify-prod.mjs --json           # машинный вывод (для Actions)
 *   node scripts/verify-prod.mjs --url https://…  # сверить другой адрес
 *
 * Ключи не нужны никакие: прод читается обычным GET, сборки идут локально.
 * Поэтому сторож работает и без доступа к Cloudflare, и без секретов GitHub.
 *
 * Код возврата: 0 — прод наш (в том числе если отстаёт), 1 — тревога,
 * 2 — проверить не удалось (сеть/сборка), это НЕ то же самое, что тревога,
 * и путать их нельзя: «не смог проверить» не повод кричать «чужой код».
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync, existsSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const arg = (name, def) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}
const URL_BASE = arg('--url', 'https://metiger-ai.pages.dev').replace(/\/+$/, '')
const COMMITS = Math.max(1, parseInt(arg('--commits', '6'), 10) || 6)
const AS_JSON = argv.includes('--json')

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim()

/** Имена файлов сборки, на которые ссылается index.html (входной JS и стили). */
function assetsOf(html) {
  const out = new Set()
  for (const m of html.matchAll(/assets\/[\w.-]+\.(?:js|css)/g)) out.add(m[0])
  return out
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** Что реально отдаёт живой адрес: имена файлов из index.html и хеши их байтов. */
async function fetchProd() {
  const res = await fetch(`${URL_BASE}/?verify=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } })
  if (!res.ok) throw new Error(`прод ответил ${res.status}`)
  const html = await res.text()
  const assets = assetsOf(html)
  if (!assets.size) throw new Error('в index.html прода нет ссылок на assets/ — это не наша страница?')
  const hashes = {}
  for (const a of assets) {
    const r = await fetch(`${URL_BASE}/${a}`, { headers: { 'cache-control': 'no-cache' } })
    if (!r.ok) throw new Error(`${a} отдался с кодом ${r.status}`)
    hashes[a] = sha256(Buffer.from(await r.arrayBuffer()))
  }
  const title = (html.match(/<title>([^<]*)<\/title>/) || [, ''])[1]
  return { assets, hashes, title, htmlHash: sha256(Buffer.from(html)) }
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
    execFileSync(
      join(ROOT, 'node_modules', '.bin', 'vite'),
      ['build', '--outDir', outDir, '--emptyOutDir'],
      { cwd: dir, stdio: 'pipe' },
    )
    const html = readFileSync(join(outDir, 'index.html'), 'utf8')
    const assets = assetsOf(html)
    const hashes = {}
    for (const a of assets) hashes[a] = sha256(readFileSync(join(outDir, a)))
    return { assets, hashes }
  } finally {
    git('worktree', 'remove', '--force', dir)
  }
}

/** Короткая подпись сборки — она и сравнивается с продом. */
const fingerprint = (o) =>
  Object.keys(o.hashes).sort().map((a) => `${a}:${o.hashes[a]}`).join('|')

function report(verdict, prod, detail, extra) {
  if (AS_JSON) {
    console.log(JSON.stringify({ verdict, url: URL_BASE, title: prod && prod.title, assets: prod && [...prod.assets], detail, ...extra }, null, 2))
    return
  }
  const line = { ok: '✅', behind: '🕓', foreign: '🚨', error: '⚠️' }[verdict] || '•'
  console.log(`${line} ${detail}`)
}

async function main() {
  const started = Date.now()
  console.log(`Сверка прода с репозиторием · ${URL_BASE}`)
  const prod = await fetchProd()
  console.log(`  прод отдаёт: ${[...prod.assets].join(', ')}`)

  const log = git('log', '--first-parent', '--format=%H', '-n', String(COMMITS), 'main').split('\n').filter(Boolean)
  if (!log.length) throw new Error('в репозитории не нашлось коммитов ветки main')
  if (log.length < COMMITS) console.log(`  (в истории доступно ${log.length} коммитов — проверяю их все)`)

  const work = mkdtempSync(join(tmpdir(), 'metiger-verify-'))
  const prodFp = fingerprint(prod)
  const tried = []
  try {
    for (const sha of log) {
      let built
      try {
        built = buildCommit(sha, work)
      } catch (e) {
        tried.push({ sha, error: String(e.message || e).slice(0, 200) })
        continue
      }
      const builtFp = fingerprint(built)
      const subject = git('log', '-1', '--format=%s', sha).slice(0, 70)
      if (builtFp === prodFp) {
        const head = git('rev-parse', 'main')
        const isHead = sha === head
        report(
          isHead ? 'ok' : 'behind',
          prod,
          isHead
            ? `прод — ровно сборка текущего main (${sha.slice(0, 7)}), байт в байт. Всё в порядке.`
            : `прод — сборка коммита ${sha.slice(0, 7)} «${subject}». Свежее в main есть, но на прод оно не уезжало — это отставание, а не подмена.`,
          { commit: sha, matches: sha, behindBy: log.indexOf(sha), ms: Date.now() - started },
        )
        process.exitCode = 0
        return
      }
      tried.push({ sha, fingerprint: builtFp, subject })
    }

    report(
      'foreign',
      prod,
      `СБОРКА НА ПРОДЕ НЕ ИЗ ЭТОГО РЕПОЗИТОРИЯ. Ни один из ${tried.length} последних коммитов main не совпал с тем, ` +
        `что отдаёт ${URL_BASE}. Либо прод выложен из другой ветки/каталога, либо его заменили. Проверять немедленно.`,
      { commit: null, tried },
    )
    process.exitCode = 1
  } finally {
    try { rmSync(work, { recursive: true, force: true }) } catch {}
  }
}

main().catch((e) => {
  report('error', null, `проверить не удалось: ${String(e.message || e)}`, { commit: null, tried: [] })
  process.exitCode = 2
})
