/**
 * SQL в той же песочнице, что JS и Python: исполняется в браузере человека, но
 * через отдельный движок — SQLite, скомпилированный в WebAssembly (sql.js).
 *
 * Зачем отдельный файл, а не ветка в sandbox.ts: Python (Pyodide) и SQLite (sql.js)
 * грузят тяжёлый рантайм с CDN, и грузить его заново на каждый «Запустить» — то же,
 * что перезапускать браузер ради одной строчки. Поэтому здесь документ статический
 * (без кода внутри), код прилетает уже после загрузки через postMessage, а iframe
 * живёт между запусками, пока его не убьют по таймауту.
 *
 * Сеть нужна ровно на один хост — CDN, откуда качается рантайм. CSP поэтому не
 * `default-src 'none'` как у JS, а точечно разрешает только jsdelivr для
 * script/connect. Собственный код человека по-прежнему не может никуда постучаться.
 */

/** Фиксированная версия: чтобы CSP-хосты и API (initSqlJs/exec) не поехали сами. */
const SQL_VER = '1.10.3'
const SQL_BASE = `https://cdn.jsdelivr.net/npm/sql.js@${SQL_VER}/dist/`

/** Первая загрузка рантайма (WASM + стандартная библиотека) — на медленной сети долго. */
export const SQL_LOAD_TIMEOUT_MS = 25000
/** Второй и далее запуски — рантайм уже тёплый. */
export const SQL_RUN_TIMEOUT_MS = 8000
export const SQL_MARK = '__metiger_sql'
export { MAX_CODE } from './sandbox'

/** Те же рамки по длине, что у JS, без JS-специфичных проверок (`require`, `process.`). */
export function prepareSql(code: string): { ok: true; code: string } | { ok: false; error: string } {
  const src = String(code == null ? '' : code).replace(/\r\n/g, '\n')
  if (!src.trim()) return { ok: false, error: 'пустой код — запускать нечего' }
  if (src.length > 20000) {
    return { ok: false, error: 'код длиннее 20000 символов — разрежь на части и запускай по очереди' }
  }
  return { ok: true, code: src }
}

/** Подсказки под частые ошибки SQLite — отдельно от JS/Python-таблиц. */
const SQL_HINTS: [RegExp, string][] = [
  [/near ".*": syntax error/, 'синтаксис SQL: проверь ключевое слово перед этим местом — запятую, скобку или имя столбца'],
  [/no such table/, 'таблицы нет: сначала создай её через CREATE TABLE (или проверь имя — регистр и опечатку)'],
  [/no such column/, 'столбца нет в таблице: проверь имя и что таблица создана до запроса'],
  [/UNIQUE constraint failed/, 'нарушена уникальность: такое значение в уникальном столбце уже есть'],
  [/datatype mismatch/, 'несовпадение типов: сравниваешь/вставляешь не тот тип (например, текст в числовой столбец)'],
  [/ambiguous column/, 'неоднозначный столбец: имя встречается в нескольких таблицах — уточни через table.column'],
  [/LIKEd? without|LIKE/, 'опечатка в LIKE или неверный шаблон: % — любая последовательность, _ — один символ'],
]

export function sqlHintFor(errText: string): string | null {
  const t = String(errText || '')
  for (let i = 0; i < SQL_HINTS.length; i++) if (SQL_HINTS[i][0].test(t)) return SQL_HINTS[i][1]
  return null
}

/**
 * Статический документ без кода внутри. `script-src`/`connect-src` сужены до
 * jsdelivr — единственный хост, с которым разрешено говорить, и только ради файлов
 * рантайма. `wasm-unsafe-eval` нужен, чтобы браузер скомпилировал WebAssembly.
 */
export function buildSqlSrcDoc(): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
      + `script-src 'unsafe-inline' ${SQL_BASE}; connect-src ${SQL_BASE}; style-src 'unsafe-inline'\">`,
    '<style>html,body{margin:0;background:transparent}</style>',
    '</head><body>',
    `<script src="${SQL_BASE}sql-wasm.js"></script>`,
    '<script>',
    'const M=' + JSON.stringify(SQL_MARK) + ';',
    'const send=(t,p)=>{try{parent.postMessage(Object.assign({[M]:1,type:t},p),"*")}catch(e){}};',
    'let SQL=null, db=null;',
    'function fmt(r){',
    '  var cols=r.columns||[], rows=r.values||[];',
    '  if(!cols.length) return "(нет столбцов)";',
    '  var w=cols.map(function(c,i){var m=String(c).length; for(var j=0;j<rows.length;j++){var s=String(rows[j][i]==null?"":rows[j][i]).length; if(s>m)m=s;} return m;});',
    '  function line(cells){return " | "+cells.map(function(c,i){return String(c==null?"":c).padEnd(w[i]);}).join(" | ")+" |";}',
    '  var sep="|"+w.map(function(x){return "-".repeat(x+2);}).join("|")+"|";',
    '  var out=[line(cols), sep];',
    '  for(var k=0;k<rows.length;k++) out.push(line(rows[k]));',
    '  return out.join("\\n");',
    '}',
    'async function boot(){',
    '  try{',
    '    SQL=await initSqlJs({locateFile:function(f){return ' + JSON.stringify(SQL_BASE) + '+f;}});',
    '    db=new SQL.Database();',
    '    send("ready",{});',
    '  }catch(e){ send("loaderror",{error:String(e&&e.message?e.message:e)}); }',
    '}',
    'addEventListener("message",async function(e){',
    '  var d=e.data; if(!d||d[M]!==1||d.type!=="run"||!db) return;',
    '  var out=[], error=null, modified=0; var t0=performance.now();',
    '  try{',
    '    var results=db.exec(String(d.code||""));',
    '    if(results&&results.length){ for(var i=0;i<results.length;i++){ out.push(fmt(results[i])); } }',
    '    else { modified=db.getRowsModified(); out.push(modified>0?("OK · изменено строк: "+modified):"OK · выполнено, результатов нет"); }',
    '  }catch(err){ error=String(err&&err.message?err.message:err); }',
    '  send("done",{value:out.join("\\n\\n"), error:error, ms:Math.round(performance.now()-t0)});',
    '});',
    'boot();',
    '</script></body></html>',
  ].join('\n')
}

export interface SqlRaw {
  value?: string | null
  error?: string | null
  ms?: number
}

/** Тот же формат ответа, что у JS/Python-песочниц (sandbox.ts / pysandbox.ts RunResult). */
export function normalizeSql(raw: SqlRaw): { ok: boolean; output: string; hint?: string; ms?: number } {
  const shown = raw && raw.value != null ? String(raw.value) : ''
  const cut = shown.length > 6000 ? shown.slice(0, 6000) + '\n…вывод обрезан на 6000 символах' : shown
  if (raw && raw.error) {
    const hint = sqlHintFor(raw.error)
    return { ok: false, output: (cut ? cut + '\n' : '') + raw.error, hint: hint || undefined, ms: raw.ms }
  }
  return { ok: true, output: cut || '(выполнено)', ms: raw && raw.ms }
}
