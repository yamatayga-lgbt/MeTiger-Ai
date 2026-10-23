/**
 * Тесты 0.237 — память проектов и закреплённых файлов между чатами.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { versionsAligned } from './version-sync.js'

let passed = 0
let failed = 0

async function t(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.error(`  ✗ ${name} — ${err && err.message ? err.message : err}`)
  }
}

const bin = join(process.cwd(), 'node_modules', '.bin', 'esbuild')
if (!existsSync(bin)) {
  console.error('✖ esbuild не найден — выполните npm ci')
  process.exit(1)
}

const dir = join(process.cwd(), 'node_modules', '.cache', 'metiger-ui237')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

function bundleTs(entry, name) {
  const out = join(dir, name)
  execFileSync(
    bin,
    [
      entry,
      '--bundle',
      '--platform=node',
      '--packages=external',
      '--format=esm',
      '--define:import.meta.env={}',
      '--outfile=' + out,
      '--loader:.ts=ts',
      '--log-level=error',
    ],
    { stdio: 'inherit' },
  )
  return out
}

const pinnedMod = await import(bundleTs('src/lib/pinnedMemory.ts', 'pinnedMemory.mjs'))
const backupMod = await import(bundleTs('src/lib/backup.ts', 'backup.mjs'))
const apiMod = await import(bundleTs('src/lib/api.ts', 'api.mjs'))

function makeMemoryStorage() {
  const map = new Map()
  return {
    get length() { return map.size },
    key: (i) => Array.from(map.keys())[i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    clear: () => { map.clear() },
  }
}

console.log('\n── 1. Память проекта и склейка закреплённых файлов (src/lib/pinnedMemory.ts) ──')

await t('T237a-1: sanitizeProjectMemory и formatProjectBlock собирают чистый блок и молчат при паузе', () => {
  const clean = pinnedMod.sanitizeProjectMemory({
    title: 'Смета ремонта квартиры',
    note: 'Валюта BYN, НДС 20%, считать по расценкам 2026 года.',
    enabled: true,
    updatedAt: 100,
  })
  const block = pinnedMod.formatProjectBlock(clean)
  assert.equal(block, 'Проект: Смета ремонта квартиры\nВалюта BYN, НДС 20%, считать по расценкам 2026 года.')

  const paused = pinnedMod.sanitizeProjectMemory({ ...clean, enabled: false })
  assert.equal(pinnedMod.formatProjectBlock(paused), '')
})

await t('T237a-2: readProjectMemory / saveProjectMemory / clearProjectMemory работают через localStorage', () => {
  const prev = globalThis.localStorage
  globalThis.localStorage = makeMemoryStorage()
  try {
    assert.equal(pinnedMod.formatProjectBlock(pinnedMod.readProjectMemory()), '')
    pinnedMod.saveProjectMemory({ title: 'Склад 1С', note: 'Кодировка таблиц UTF-8 с BOM', enabled: true })
    const loaded = pinnedMod.readProjectMemory()
    assert.equal(loaded.title, 'Склад 1С')
    assert.equal(loaded.enabled, true)
    assert.match(pinnedMod.formatProjectBlock(loaded), /Проект: Склад 1С/)

    pinnedMod.clearProjectMemory()
    assert.equal(globalThis.localStorage.getItem(pinnedMod.PROJECT_MEM_KEY), null)
  } finally {
    globalThis.localStorage = prev
  }
})

await t('T237a-3: mergePinnedDocs держит явные файлы первыми, убирает дубли, пропускает паузу и соблюдает лимиты', () => {
  const explicit = [
    { name: 'Акт_апрель.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 1200, b64: 'AAAA', kind: 'file' },
  ]
  const pinned = [
    { id: '1', name: 'Акт_апрель.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 1200, b64: 'AAAA', kind: 'file', enabled: true, pinnedAt: 3 },
    { id: '2', name: 'Прайс_2026.pdf', mime: 'application/pdf', size: 2000, b64: 'BBBB', kind: 'file', enabled: true, pinnedAt: 2 },
    { id: '3', name: 'Черновик_выкл.txt', mime: 'text/plain', size: 500, b64: 'CCCC', kind: 'file', enabled: false, pinnedAt: 1 },
    { id: '4', name: 'Тяжёлый.pdf', mime: 'application/pdf', size: 9000, b64: 'DDDD', kind: 'file', enabled: true, pinnedAt: 0 },
  ]

  const merged = pinnedMod.mergePinnedDocs(explicit, pinned, 6, 5000)
  assert.equal(merged.attachments.length, 2)
  assert.equal(merged.attachments[0].name, 'Акт_апрель.xlsx')
  assert.equal(merged.attachments[1].name, 'Прайс_2026.pdf')
  assert.deepEqual(merged.pinnedNames, ['Прайс_2026.pdf'])
})

console.log('\n── 2. Автоматическая подача в sendChat и чистый skipPinned (src/lib/api.ts) ──')

await t('T237b-1: sendChat передаёт активный проект в caseContext и пропускает его при паузе или skipPinned', async () => {
  const prevStorage = globalThis.localStorage
  const prevFetch = globalThis.fetch
  const sentBodies = []
  globalThis.localStorage = makeMemoryStorage()
  globalThis.fetch = async (_url, init) => {
    sentBodies.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ ok: true, text: 'Принято', provider: 'groq', model: 'test' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    // 1. Без памяти проекта — тело чистое, ни caseContext, ни attachments.
    await apiMod.sendChat('Привет', [])
    assert.equal(sentBodies[0].caseContext, undefined)
    assert.equal(sentBodies[0].attachments, undefined)

    // 2. Включили проект — уходит в caseContext во всех чатах автоматически.
    pinnedMod.saveProjectMemory({ title: 'Коттедж 140 м²', note: 'Считаем фундамент УШП в рублях', enabled: true })
    await apiMod.sendChat('Посчитай бетон М350', [])
    assert.match(sentBodies[1].caseContext, /Проект: Коттедж 140 м²/)
    assert.match(sentBodies[1].caseContext, /УШП/)

    // 3. skipPinned (при дописывании оборванного хвоста) не дублирует память проекта.
    await apiMod.sendChat('Допиши хвост', [], { skipPinned: true })
    assert.equal(sentBodies[2].caseContext, undefined)
  } finally {
    globalThis.localStorage = prevStorage
    globalThis.fetch = prevFetch
  }
})

console.log('\n── 3. Резервная копия, интерфейс и синхронизация версий ──')

await t('T237c-1: buildBackup и parseBackup сохраняют закреплённые файлы и ключ mt-project-mem', () => {
  const raw = JSON.stringify(
    backupMod.buildBackup({
      local: { 'mt-project-mem': '{"title":"ТЗ","note":"React 18","enabled":true,"updatedAt":1}' },
      pinned: [{ id: 'pin-1', name: 'ТЗ.pdf', mime: 'application/pdf', size: 1024, kind: 'file', b64: 'JVBERi0xLjQK', enabled: true, pinnedAt: 1 }],
      now: 1700000000000,
    }),
  )
  const parsed = backupMod.parseBackup(raw)
  assert.equal(Array.isArray(parsed.pinned), true)
  assert.equal(parsed.pinned.length, 1)
  assert.equal(parsed.local['mt-project-mem'] !== undefined, true)
})

await t('T237c-2: экраны Памяти, вложений и чата содержат точки управления закреплёнными файлами и версией', () => {
  const memSrc = readFileSync('src/views/MemoryView.tsx', 'utf8')
  const attSrc = readFileSync('src/components/AttachMenu.tsx', 'utf8')
  const chatSrc = readFileSync('src/views/ChatView.tsx', 'utf8')
  const notesSrc = readFileSync('src/lib/release-notes.ts', 'utf8')

  assert.match(memSrc, /Память проекта и закреплённые файлы/)
  assert.match(memSrc, /Закрепить файл/)
  assert.equal(/общая память/i.test(memSrc), false)
  assert.equal(/autocomplete/i.test(memSrc), false)

  assert.match(attSrc, /В памяти между чатами/)
  assert.match(attSrc, /Закрепить .* в память/)
  assert.match(chatSrc, /className="pinned-strip"/)

  const v = versionsAligned()
  assert.equal(v.ok, true, v.why)
  assert.equal(/\b(src\/|engine\/|functions\/|localStorage|IndexedDB|caseContext)\b/.test(notesSrc), false)
})

if (failed > 0) {
  console.error(`\n✗ Провалено: ${failed} из ${passed + failed}`)
  process.exit(1)
}
console.log(`\n✓ Все проверки 0.237 пройдены (${passed})`)
