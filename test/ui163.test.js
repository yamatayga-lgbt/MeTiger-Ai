/**
 * 0.163: свежесть источников (волна «обогнать DeepSeek», пункт 3).
 *
 * Что защищаем:
 *   • дату страницы берём ТОЛЬКО из разметки и только разумную — выдуманных дат нет;
 *   • дата доезжает до источника, до блока для модели и до плашки под ответом;
 *   • модели сказано, что делать со старыми данными;
 *   • живой стенд свежести существует и запускается руками (в CI ему не место:
 *     красный прогон из-за чужого лимита поисковика — не про наш код).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { versionsAligned } from './version-sync.js';

const search = readFileSync('engine/search.js', 'utf8');
const tools = readFileSync('engine/tools.js', 'utf8');
const api = readFileSync('src/lib/api.ts', 'utf8');
const chatView = readFileSync('src/views/ChatView.tsx', 'utf8');
const css = readFileSync('src/styles/index.css', 'utf8');
const version = readFileSync('src/lib/version.ts', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const vmd = readFileSync('VERSION.md', 'utf8');
const notes = readFileSync('src/lib/release-notes.ts', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const stand = readFileSync('scripts/search-stand.mjs', 'utf8');
const testChain = String(pkg.scripts.test || '');

const ok = (name, condition) => {
  assert.ok(condition, name);
  console.log('  ✔ ' + name);
};

const currentVersion = version.match(/APP_VERSION = '([^']+)'/)?.[1];
ok('U163a все источники версии синхронизированы (version.ts, package.json, package-lock, VERSION.md)',
  versionsAligned().ok, versionsAligned().why);
ok('U163b «Что нового» и README знают про 0.163',
  /version: '0\.163'/.test(notes) && /У источников видно дату/.test(notes) && /\*\*0\.163\*\*/.test(readme));

ok('U163c дата читается из разметки страницы: мета в обоих порядках, <time>, микроразметка',
  search.indexOf('export function dateOf') >= 0
    && search.indexOf('article:published_time') >= 0
    && search.indexOf('(?:property|name|itemprop)') >= 0
    && search.indexOf('content=["\']([^"\']+)["\'][^>]*(?:property|name|itemprop)') >= 0
    && search.indexOf('<time[^>]+datetime=') >= 0
    && search.indexOf('"datePublished"') >= 0,
  JSON.stringify({
    meta: search.indexOf('article:published_time'),
    both: search.indexOf('(?:property|name|itemprop)'),
    rev: search.indexOf('content=["\']([^"\']+)["\'][^>]*(?:property|name|itemprop)'),
    time: search.indexOf('<time[^>]+datetime='),
    ld: search.indexOf('"datePublished"'),
  }));
ok('U163d нелепый год отсекается: битая разметка не выглядит свежестью',
  /function saneDate/.test(search) && /y < 1995/.test(search) && /getFullYear\(\) \+ 1/.test(search));
ok('U163e дата едет от прочитанной страницы к источнику и в блок для модели',
  /const date = dateOf\(html\)/.test(search) && /if \(r && r\.date\) s\.date = r\.date/.test(search)
    && /· от ' \+ s\.date/.test(search));
ok('U163f модели сказано, что делать со старыми данными (а не выдавать их за свежие)',
  /больше года/.test(search) && /скажи об этом человеку/.test(search));
ok('U163g дата источника вынимается из блока поиска и уезжает в плашку',
  /const dm = \/·\\s\*от\\s\*\(\\d\{4\}-\\d\{2\}-\\d\{2\}\)\//.test(tools) && /out\.push\(date \? \{ title: t, url, date \}/.test(tools));
ok('U163h тип источника знает про дату, а подпись переводит её в слова',
  /date\?: string/.test(api) && /export function sourceDate/.test(api)
    && /'сегодня'/.test(api) && /'вчера'/.test(api) && /'дней'/.test(api) && /' назад'/.test(api));
ok('U163i дата видна на плашке источника и подписана стилем',
  /msg-source-date/.test(chatView) && /sourceDate\(s\.date\)/.test(chatView) && /\.msg-source-date/.test(css));
ok('U163j живой стенд свежести есть: 20 вопросов и отказ при отсутствии дат',
  /QUESTIONS/.test(stand) && /search-stand/.test(stand) && /dateOf/.test(stand)
    && (stand.match(/'[^']+',\n/g) || []).length >= 15 && /с датой/.test(stand));
ok('U163k тест 0.163 в цепочке прогона', /node test\/ui163\.test\.js/.test(testChain));

console.log('\n0.163: все проверки пройдены');
