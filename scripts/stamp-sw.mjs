#!/usr/bin/env node
// Перед каждой сборкой вписывает текущую версию из package.json в CACHE_VERSION
// service worker'а (public/sw.js). Раньше это делалось руками и в трёх релизах
// подряд (0.060–0.062) я забыл её обновить — из-за этого браузер не видел, что
// sw.js изменился, не проходил through install/activate и у людей залипала
// старая оболочка. Теперь версия берётся из package.json сама, забыть нельзя.
import { readFileSync, writeFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const version = `v${String(pkg.version).replace(/\./g, '')}`

const swPath = 'public/sw.js'
const src = readFileSync(swPath, 'utf8')
const next = src.replace(/const CACHE_VERSION = '[^']*'/, `const CACHE_VERSION = '${version}'`)

if (next === src && !src.includes(`'${version}'`)) {
  console.error(`stamp-sw: не нашёл строку CACHE_VERSION в ${swPath} — проверь файл руками`)
  process.exit(1)
}

writeFileSync(swPath, next)
console.log(`stamp-sw: CACHE_VERSION = '${version}' (из package.json ${pkg.version})`)
