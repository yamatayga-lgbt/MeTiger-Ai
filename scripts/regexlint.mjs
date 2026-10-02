/* Линт файлов навыков. Сюда собраны все классы дефектов, на которых мы спотыкались фазами
   08–21, чтобы их ловил один запуск, а не «вернёмся и починим в третий раз»:
     · правка через второй интерпретатор: \b превращается в байт 0x08, а \\b — в мёртвую ветку;
     · диапазон кириллицы в классе ([ь-и]) — JS падает с «Range out of order»;
     · квантификатор сразу после \b — «Nothing to repeat»;
     · потерянный хвост «/i, {» и уехавшая скобка — файл компилируется, триггер молчит;
     · ключ text вместо prompt — навык едет с desc вместо методики;
     · CJK-огрызки из генерации;
     · голый корень («поправ», «пагинац»), который накрывает соседние ветки и стреляет по бытовому.
   Голый корень сам по себе — замечание (в 18+ он и есть предмет разговора), мёртвая ветка — ошибка.
   Файл может снять замечания строкой «lint: bare-roots-ok» в комментарии.
   Запуск: node scripts/regexlint.mjs engine/skills/*.js */
import fs from 'fs';

const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const BARE = /^[а-яё]{4,12}$/; // кириллический корень без падежного хвоста и без окружения
/* Латинские слова (openapi, deadlock) голыми не считаем: они и есть целые термины. */
let bad = 0;
let hints = 0;
const err = (p, i, msg) => { bad++; console.log('✗ ' + p + (i == null ? '' : ':' + (i + 1)) + ' — ' + msg); };
const hint = (p, i, msg) => { hints++; if (SHOW_HINTS) console.log('! ' + p + (i == null ? '' : ':' + (i + 1)) + ' — ' + msg); };

/* Обход регулярки: скобки, классы, квест. Возвращает ошибку или список классов. */
function scan(src) {
  let depth = 0; let inCls = false; let esc = false;
  const cls = [];
  for (let k = 0; k < src.length; k++) {
    const c = src[k];
    if (esc) {
      esc = false;
      if ('bB'.includes(c) && '?*+{'.includes(src[k + 1])) return { error: 'квантификатор сразу после \\b — «Nothing to repeat»' };
      if (c === '\\') return { error: 'двойной экранированный \\b/\\d — правка проходила через второй интерпретатор' };
      continue;
    }
    if (c === '\\') { esc = true; continue; }
    if (inCls) { if (c === ']') { inCls = false; cls.at(-1)[1] = k; } else cls.at(-1)[2] += c; continue; }
    if (c === '[') { inCls = true; cls.push([k, k, '']); continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth < 0) return { error: 'лишняя )' }; }
  }
  if (esc) return { error: 'регулярка обрывается на бэкслеше' };
  if (inCls) return { error: 'незакрытый класс' };
  if (depth !== 0) return { error: 'баланс скобок ' + depth };
  return { cls };
}

/* Ветки верхнего уровня. Все наши триггеры — одна внешняя группа: её снимаем, дальше делим по |. */
function branches(src) {
  let body = src.trim();
  const strip = (b) => {
    let d = 0; let inCls = false; let closes = -1;
    for (let k = 0; k < body.length; k++) {
      const c = body[k];
      if (c === '\\') { k++; continue; }
      if (inCls) { if (c === ']') inCls = false; continue; }
      if (c === '[') { inCls = true; continue; }
      if (c === '(') d++;
      else if (c === ')') { d--; if (d === 0) { closes = k; break; } }
    }
    if (closes === b.length - 1) return b.slice(1, -1);
    return null;
  };
  const inner = strip(body);
  if (inner !== null) body = inner;
  else { const first = strip(body.slice(body.indexOf('('))); if (first !== null && body.indexOf('(') === 0) body = first; }
  const res = []; let depth = 0; let inCls = false; let cur = '';
  for (let k = 0; k < body.length; k++) {
    const c = body[k];
    if (c === '\\') { cur += c + (body[k + 1] || ''); k++; continue; }
    if (inCls) { cur += c; if (c === ']') inCls = false; continue; }
    if (c === '[') { inCls = true; cur += c; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === '|' && depth === 0) { res.push(cur); cur = ''; continue; }
    cur += c;
  }
  res.push(cur);
  return res.map((x) => x.trim()).filter(Boolean);
}

const argv = process.argv.slice(2);
const SHOW_HINTS = argv.includes('--hints');
const files = argv.filter((a) => a !== '--hints');
for (const p of files) {
  const raw = fs.readFileSync(p, 'utf8');
  const bareOk = /lint: bare-roots-ok/.test(raw);
  const lines = raw.split('\n');

  lines.forEach((line, i) => {
    const c = line.match(CTRL);
    if (c) err(p, i, 'управляющий байт 0x' + c[0].charCodeAt(0).toString(16) + ' — правка проходила через второй интерпретатор');
  });
  const cjk = raw.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u33ff]/g); // 【】 у нас в ходу, идеограммы — нет
  if (cjk) err(p, null, 'CJK-мусор: ' + JSON.stringify(cjk.slice(0, 6).join('')));
  if (/^\s*text:\s/m.test(raw)) err(p, null, 'ключ text вместо prompt: навык поедет с desc вместо методики');

  lines.forEach((line, i) => {
    if (!line.startsWith('    /')) return;
    const m = line.match(/^    \/(.*)\/([gimsuy]*), \{$/);
    if (!m) {
      /* Донорские файлы пишут регулярки в несколько строк — это не поломка. Ругаемся только
         когда сразу за строкой идут настройки навыка: значит хвост «/i, {» потерян при правке. */
      const nx = lines[i + 1] || '';
      if (/^      (priority|prompt|tools|need|supersedes|desc|always):/.test(nx) || /^\s*\}\)/.test(nx)) {
        err(p, i, 'у строки-триггера нет хвоста «/i, {» — правка съела его');
      }
      return;
    }
    const src = m[1];
    if (CTRL.test(src)) { err(p, i, 'управляющий байт в триггере'); return; }

    const s = scan(src);
    if (s.error) { err(p, i, s.error); return; }

    if (src.startsWith('^')) {
      hint(p, i, 'триггер заякорен на «^» — навык сработает только если фраза НАЧИНАЕТСЯ с этого; для «кроме такого» нужен вид «^(?!…).*»');
    }

    /* «\b» на кириллице мертва: без флага u в JS \w = [A-Za-z0-9_], буква не «словесная»,
       поэтому граница слова рядом с кириллицей не наступает никогда. Ветка с таким \b
       живёт в файле и ни разу не срабатывает — ровно так умер «spec» у донорского docs. */
    { const cyr = /\\b(?=[а-яё])|[а-яё]\\b/.exec(src);
      if (cyr) { err(p, i, 'граница слова \\b на кириллице мертва — убери её или замени на «[\\s.,;:!?]»'); return; } }

    for (const [, , body] of s.cls) {
      for (const rg of body.match(/[^\\\]]-[^\\\]]/g) || []) {
        if (rg[1] !== '-') continue;
        if (rg[0].codePointAt(0) > rg[2].codePointAt(0)) { err(p, i, 'перевёрнутый диапазон «' + rg + '» в классе — JS падает с «Range out of order»'); return; }
        /* [а-ею] читают как «а-я без ё», а это а…е: падежные хвосты за пределами молчат */
        if (rg[0] === 'а' && rg[2] !== 'я' && rg[2] !== 'яё') { hint(p, i, 'короткий диапазон «' + rg + '» — скорее всего задумано [а-яё]'); }
      }
    }

    try { new RegExp(src, m[2] || 'i'); } catch (e) { err(p, i, 'не компилируется: ' + e.message.slice(0, 90)); return; }

    /* «||» и «(|» значат пустую ветку: она матчит пустую строку, то есть любую фразу.
       Так и рождается — отрезали ветку посередине, два символа остались подряд. Навык
       тогда всплывает на «сколько сохнет пластырь», и выглядит как порча реестра, а не
       как ошибка одной строки. «x|)» при этом законно: `(сам |)` — у донора так записан
       факультативный префикс, поэтому хвостовую пустую ветку не трогаем. */
    {
      let d2 = 0; let cls2 = false; let hit = -1; let afterOpen = false;
      for (let k = 0; k < src.length; k++) {
        const ch = src[k];
        /* Экранированный символ — не структурный: «\\s|» — это «пробел ИЛИ», а не пустая
           ветка, и «\\(|» — литеральная скобка ИЛИ. Значит на них флаг не ставим. */
        if (ch === '\\') { k++; afterOpen = false; continue; }
        if (cls2) { if (ch === ']') cls2 = false; afterOpen = false; continue; }
        if (ch === '[') { cls2 = true; afterOpen = false; continue; }
        if (ch === '(') { d2++; afterOpen = true; continue; }
        if (ch === ')') { d2--; afterOpen = false; continue; }
        if (ch === '|') {
          if (src[k + 1] === '|' || afterOpen) { hit = k; break; }
          afterOpen = false; continue;
        }
        afterOpen = false;
      }
      if (hit >= 0) { err(p, i, 'пустая альтернатива около позиции ' + hit + ' — триггер матчит любую фразу'); return; }
    }

    const top = branches(src);
    const bare = top.filter((b) => BARE.test(b));
    for (const b of bare) hint(p, i, 'голый корень «' + b + '» — если он нужен не только в этом домене, добавьте окружение (корпус бытовых фраз это и проверит)');
    for (const b of top) {
      if (b.length < 4 || /^[([]/.test(b)) continue;
      const swallow = bare.find((o) => o !== b && b.startsWith(o));
      if (swallow) { hint(p, i, 'ветка «' + b.slice(0, 30) + (b.length > 30 ? '…' : '') + '» недостижима: её накрывает короткая ветка «' + swallow + '»'); break; }
    }
  });
}
if (hints) console.log('  (замечаний по стилю: ' + hints + (SHOW_HINTS ? '' : ' — подробности с --hints') + ', ошибок нет)');
console.log(bad ? 'проблем: ' + bad : 'лайнтер чист');
process.exit(bad ? 1 : 0);
