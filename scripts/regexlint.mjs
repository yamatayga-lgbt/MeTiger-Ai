/* Линт строк-регулярок в файлах навыков: баланс скобок вне [...] и после \, плюс мусор.
   Запуск: node scripts/regexlint.mjs engine/skills/*.js */
import fs from 'fs';

const files = process.argv.slice(2);
let bad = 0;
for (const p of files) {
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const m = line.match(/^\s*\/(.*)\/i, \{$/);
    if (!m) return;
    const src = m[1];
    let depth = 0; let inCls = false; let err = null;
    for (let k = 0; k < src.length; k++) {
      const c = src[k];
      if (c === '\\') { k++; continue; }
      if (inCls) { if (c === ']') inCls = false; continue; }
      if (c === '[') { inCls = true; continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth < 0) { err = 'лишняя )'; break; } }
    }
    if (!err && inCls) err = 'незакрытый класс';
    if (!err && depth !== 0) err = 'баланс скобок ' + depth;
    // мусор, который проскакивает при генерации
    if (!err && /[\u3000-\u9fff\uff00-\uffef]/.test(src)) err = 'CJK-мусор';
    if (!err && /\u0000/.test(src)) err = 'NUL';
    if (!err && /а-z|я-z|а-яё]*$/.test(src)) err = 'подозрительный диапазон';
    if (!err && /\\\\[bBdDsSwW(+*)]/.test(src)) err = 'двойной экранированный \\b/\\d';
    if (err) { bad++; console.log('✗ ' + p + ':' + (i + 1) + ' — ' + err); }
  });
  // CJK где угодно в файле
  const whole = fs.readFileSync(p, 'utf8');
  const cjk = whole.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u33ff]/g); // 【】 у нас в ходу, идеограммы — нет
  if (cjk) { bad++; console.log('✗ ' + p + ' — CJK в тексте: ' + JSON.stringify(cjk.slice(0, 6).join(''))); }
}
console.log(bad ? 'проблем: ' + bad : 'лайнтер чист');
process.exit(bad ? 1 : 0);
