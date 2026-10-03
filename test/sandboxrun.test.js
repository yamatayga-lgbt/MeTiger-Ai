/**
 * Песочница в деле: не только тексты про CSP, а реальный прогон harness'а.
 *
 * srcdoc-документ строится в src/lib/sandbox.ts, его внутренний модуль-скрипт здесь
 * вынимается и ИСПОЛНЯЕТСЯ — с подставленным `parent.postMessage` и `addEventListener`
 * вместо браузера. Иначе проверки L1–L16 в test/front.test.js мерили бы строку, а не
 * поведение: «код напечатал», «ошибка долетела», «спам обрезан» — это то, что можно
 * проверить только запустив.
 *
 *   node test/sandboxrun.test.js
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
/* Сиротские Promise-отклонения из песочницы: слушаем, чтобы Node не считал это падением. */
const stray = [];
process.on('unhandledRejection', (e) => stray.push(String((e && e.message) || e)));
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + extra : '')); }
}

const bin = join(process.cwd(), 'node_modules', '.bin', 'esbuild');
if (!existsSync(bin)) {
  console.log('✖ нет esbuild — проверки НЕ выполнены (установка: npm ci)');
  process.exit(1);
}
const dir = join(process.cwd(), 'node_modules', '.cache', 'metiger-sandbox');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const mod = join(dir, 'sandbox.mjs');
execFileSync(bin, ['src/lib/sandbox.ts', '--bundle', '--platform=node', '--format=esm', '--outfile=' + mod],
  { cwd: process.cwd(), stdio: 'pipe' });
const S = await import(mod);
let n = 0;

/** Вынуть тело модуля из srcdoc и исполнить так, как его исполнит браузер. */
async function runChild(code) {
  const doc = S.buildSrcDoc(code);
  const body = /<script type="module">([\s\S]*?)<\/script>/.exec(doc);
  if (!body) throw new Error('в документе нет модульного скрипта — песочнице нечего исполнять');
  const captured = [];
  const handlers = {};
  /* Harness переопределяет console ИСПОЛНЯЕМОГО кода — а он в Node глобальный,
     поэтому после прогона надо вернуть как было, иначе тест перестанет печатать
     собственные проверки (это, кстати, и был первый провал: тишина вместо чисел). */
  const prevParent = globalThis.parent, prevAdd = globalThis.addEventListener;
  globalThis.parent = { postMessage: (m) => captured.push(m) };
  globalThis.addEventListener = (t, h) => { handlers[t] = h; };
  const keys = ['log', 'info', 'warn', 'error', 'debug', 'table', 'assert'];
  const saved = Object.fromEntries(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis.console, k)]));
  const file = join(dir, 'harness' + (n++) + '.mjs');
  writeFileSync(file, body[1]);
  try {
    await import(file);
  } catch (e) {
    /* синтаксическая ошибка самого harness'а — тоже провал, и он должен быть виден */
    captured.push({ type: 'harness-error', error: String(e && e.message) });
  } finally {
    for (const k of keys) {
      const d = saved[k];
      if (d) Object.defineProperty(globalThis.console, k, d); else delete globalThis.console[k];
    }
    globalThis.parent = prevParent;
    globalThis.addEventListener = prevAdd;
  }
  return { msg: captured[captured.length - 1] || null, captured, handlers, doc };
}

console.log('── R · harness исполняет код и честно отчитывается о результате ───');
{
  const r = await runChild('console.log(2 ** 10); return "готово"');
  ok('R1: console и возвращённое значение долетают до родителя',
    !!r.msg && r.msg.type === 'done' && r.msg.logs.join('|') === '1024' && r.msg.value === 'готово',
    JSON.stringify(r.msg));
  ok('R2: сообщение помечено — по метке отсекается любой чужой postMessage',
    !!r.msg && r.msg[S.MARK] === 1, JSON.stringify(Object.keys(r.msg || {})));

  const e = await runChild('const o = undefined; return o.x');
  ok('R3: ошибка страницы приходит как текст с именем типа, а не тишина',
    !!e.msg && e.msg.type === 'done' && /TypeError/.test(e.msg.error || ''), JSON.stringify(e.msg));
  const norm = S.normalize(e.msg, 'const o = undefined; return o.x');
  ok('R4: на эту ошибку есть подсказка, и ok:false',
    norm.ok === false && /undefined/.test(norm.hint || ''), JSON.stringify({ ok: norm.ok, hint: norm.hint }));

  const spam = await runChild('for (let i = 0; i < 500; i++) console.log(i)');
  ok('R5: 500 строк лога превращаются в потолок и слово об обрезке',
    !!spam.msg && spam.msg.logs.length === S.MAX_LOGS + 1
      && /обрезан/.test(spam.msg.logs[S.MAX_LOGS]), spam.msg ? String(spam.msg.logs.length) : 'нет сообщения');

  const long = await runChild('return "' + 'д'.repeat(900) + '"');
  ok('R6: длинное значение режется внутри harness’а, а не доезжает до родителя целиком',
    !!long.msg && long.msg.value.length <= 501, String((long.msg && long.msg.value.length) || 0));

  /* </script> внутри строки: экранирование должно остаться валидным JS (\/ === /). */
  const esc = await runChild('console.log("</scr' + 'ipt>" + "!.length"); return 1');
  ok('R7: обезвреженный </script> не ломает сам код: строка печатается как была',
    !!esc.msg && esc.msg.logs.join('') === '</script>!.length', JSON.stringify(esc.msg && esc.msg.logs));
  const deep = await runChild('return [1, [2, 3], { a: [4] }]');
  ok('R8: структуры значений сериализуются, а не превращаются в [object]',
    !!deep.msg && deep.msg.value === '[1,[2,3],{"a":[4]}]', String(deep.msg && deep.msg.value));

  const silent = await runChild('let x = 1; x = x + 1');
  ok('R9: код без вывода и без return даёт value "undefined", и это ловит normalize',
    !!silent.msg && /ничего не вернул/.test(S.normalize(silent.msg, 'let x = 1').output),
    JSON.stringify(silent.msg && silent.msg.value));

  const sync = await runChild('await new Promise((r) => setTimeout(r, 5)); return "после паузы"');
  ok('R10: асинхронщину не запрещаем: top-level await в модуле работает',
    !!sync.msg && sync.msg.value === 'после паузы', JSON.stringify(sync.msg));

  /* В браузере такое отклонение ловит addEventListener('unhandledrejection'). В Node
     послать его некому, и Node счёл бы прогон упавшим — поэтому сиротские отклонения
     собираются в `stray` (слушатель висит с начала файла) и проверяются отдельным
     пунктом: песочница обязана пережить их молча, а не унести с собой всю страницу. */
  const thrown = await runChild('Promise.reject(new Error("нет сети сюда")); return 1');
  await new Promise((r) => setImmediate(r));
  ok('R11b: сиротское отклонение не уронило прогон и записано в сборщик',
    stray.length === 1 && /нет сети сюда/.test(stray[0]), JSON.stringify(stray));
  /* Сам факт отправки события проверяется только в браузере; здесь — что слушатель
     навешан до кода и ни одно отклонение не проглатывается молча. */
  ok('R11: на unhandledrejection висит слушатель (и на error тоже)',
    Object.keys(thrown.handlers).includes('unhandledrejection') && Object.keys(thrown.handlers).includes('error'),
    JSON.stringify(Object.keys(thrown.handlers)));

  ok('R12: в документе нет ничего, что разрешило бы сеть или наш origin',
    /default-src 'none'/.test(esc.doc) && !/allow-same-origin/.test(esc.doc), esc.doc.slice(0, 90));
  ok('R13: harness не использует eval и new Function (на платформе они запрещены)',
    !/\beval\(|new Function/.test(esc.doc));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
rmSync(dir, { recursive: true, force: true });
