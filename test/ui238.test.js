/**
 * Тесты 0.238 — умное сжатие, распознавание чеков/документов и кадрирование фото с камеры телефона.
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

const dir = join(process.cwd(), 'node_modules', '.cache', 'metiger-ui238')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const out = join(dir, 'images.mjs')
// Собираем без --bundle, как и front.test.js — проверяем самодостаточность модуля.
execFileSync(bin, ['src/lib/images.ts', '--format=esm', '--outfile=' + out, '--loader:.ts=ts', '--log-level=error'], {
  stdio: 'inherit',
})
const img = await import(out)

console.log('\n── 1. Распознавание чеков, улучшение мелкого текста и автокрая (src/lib/images.ts) ──')

await t('T238a-1: detectDocumentLike отличает чек/лист с текстом от цветного бытового снимка', () => {
  const w = 120
  const h = 180
  const receipt = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      // Строки текста каждые 9 пикселей на светло-серой бумаге чека.
      const isInk = x > 14 && x < 106 && y % 9 === 3 && x % 3 !== 0
      const v = isInk ? 52 : 212
      receipt[o] = v
      receipt[o + 1] = v - 2
      receipt[o + 2] = v - 5
      receipt[o + 3] = 255
    }
  }
  assert.equal(img.detectDocumentLike(receipt, w, h), true)

  const colorful = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    colorful[o] = 230
    colorful[o + 1] = 95
    colorful[o + 2] = 40
    colorful[o + 3] = 255
  }
  assert.equal(img.detectDocumentLike(colorful, w, h), false)
})

await t('T238a-2: enhanceDocumentPixels осветляет тень бумаги и усиливает бледные чернила чека', () => {
  const w = 60
  const h = 60
  const shadowed = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const isText = y >= 20 && y <= 40 && x % 6 === 2
      // Затенённая бумага (180) и выцветший термочек (85)
      const v = isText ? 85 : 180
      shadowed[o] = v
      shadowed[o + 1] = v
      shadowed[o + 2] = v
      shadowed[o + 3] = 255
    }
  }
  const enhanced = img.enhanceDocumentPixels(shadowed, w, h)
  const paperAfter = enhanced[(5 * w + 5) * 4]
  const inkAfter = enhanced[(30 * w + 14) * 4]
  assert.ok(paperAfter >= 230, `ожидалась чистая бумага >= 230, получено ${paperAfter}`)
  assert.ok(inkAfter <= 45, `ожидались тёмные чернила <= 45, получено ${inkAfter}`)
})

await t('T238a-3: autoFindContentBounds находит лист чека на тёмном столе и не режет кадр без полей', () => {
  const w = 100
  const h = 100
  const desk = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const onSheet = x >= 25 && x <= 75 && y >= 15 && y <= 85
      const v = onSheet ? 225 : 42
      desk[o] = v
      desk[o + 1] = v
      desk[o + 2] = v
      desk[o + 3] = 255
    }
  }
  const box = img.autoFindContentBounds(desk, w, h)
  assert.ok(box.x >= 0.18 && box.x <= 0.28, `box.x=${box.x}`)
  assert.ok(box.y >= 0.08 && box.y <= 0.18, `box.y=${box.y}`)
  assert.ok(box.w >= 0.48 && box.w <= 0.60, `box.w=${box.w}`)
  assert.ok(box.h >= 0.68 && box.h <= 0.80, `box.h=${box.h}`)
})

console.log('\n── 2. Поворот, кадрирование и мобильный бюджет сети ──')

await t('T238b-1: transformPixels корректно поворачивает на 90° и вырезает выбранную область', () => {
  // Кадр 4×2: верхняя строка красная, нижняя синяя.
  const src = new Uint8ClampedArray(4 * 2 * 4)
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 4; x++) {
      const o = (y * 4 + x) * 4
      src[o] = y === 0 ? 250 : 10
      src[o + 2] = y === 1 ? 240 : 10
      src[o + 3] = 255
    }
  }
  const rot90 = img.transformPixels(src, 4, 2, { rotate: 90 })
  assert.equal(rot90.width, 2)
  assert.equal(rot90.height, 4)
  // После поворота на 90° по часовой верхняя строка (y=0) переехала в правый столбец (x=1).
  assert.equal(rot90.rgba[(0 * 2 + 1) * 4], 250)
  assert.equal(rot90.rgba[(0 * 2 + 0) * 4 + 2], 240)

  const cropped = img.transformPixels(rot90.rgba, rot90.width, rot90.height, {
    crop: { x: 0.5, y: 0, w: 0.5, h: 0.5 },
  })
  assert.equal(cropped.width, 1)
  assert.equal(cropped.height, 2)
  assert.equal(cropped.rgba[0], 250)
})

await t('T238b-2: потолки сторон и детектор медленной сети (2G/3G/saveData) настроены бережно', () => {
  assert.equal(img.MAX_SIDE, 1024)
  assert.equal(img.DOC_MAX_SIDE, 1600)
  assert.equal(img.isSlowMobileNetwork({ saveData: true, effectiveType: '4g' }), true)
  assert.equal(img.isSlowMobileNetwork({ saveData: false, effectiveType: '3g' }), true)
  assert.equal(img.isSlowMobileNetwork({ saveData: false, effectiveType: '4g' }), false)
})

console.log('\n── 3. Врезка окна подготовки фото в чат и синхронизация версий ──')

await t('T238c-1: PhotoPrepModal подключён к камере и миниатюрам вложений, версия 0.238 согласована', () => {
  const modalSrc = readFileSync('src/components/PhotoPrepModal.tsx', 'utf8')
  const chatSrc = readFileSync('src/views/ChatView.tsx', 'utf8')
  const notesSrc = readFileSync('src/lib/release-notes.ts', 'utf8')

  assert.match(modalSrc, /Автокрая/)
  assert.match(modalSrc, /Чек \/ текст/)
  assert.match(modalSrc, /90°/)
  assert.match(chatSrc, /addFiles\(e\.target\.files, true\)/)
  assert.match(chatSrc, /кадрировать картинку/)
  assert.match(chatSrc, /<PhotoPrepModal/)

  const v = versionsAligned()
  assert.equal(v.ok, true, v.why)
  assert.equal(/\b(src\/|engine\/|functions\/|MAX_SIDE|DOC_MAX_SIDE|EXIF)\b/.test(notesSrc), false)
})

if (failed > 0) {
  console.error(`\n✗ Провалено: ${failed} из ${passed + failed}`)
  process.exit(1)
}
console.log(`\n✓ Все проверки 0.238 пройдены (${passed})`)
