/**
 * Резервная копия данных (src/lib/backup.ts, 0.162).
 *
 * Копия — единственное место, где ошибка стоит человеку всей переписки: молча
 * принять чужой файл, обрезанный JSON или пустую копию нельзя. Проверяем ровно
 * это: что собираем, что отказываемся принимать и что замена не трогает чужие
 * ключи браузера.
 *
 *   node test/backup.test.js
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 200) : '')); }
}

const bin = join(process.cwd(), 'node_modules', '.bin', 'esbuild');
if (!existsSync(bin)) {
  console.log('✖ копия: esbuild не найден — проверки НЕ выполнены. Нужно `npm ci`.');
  process.exit(1);
}
const dir = join(process.cwd(), 'node_modules', '.cache', 'metiger-backup');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const out = join(dir, 'backup.mjs');
execFileSync(bin, ['src/lib/backup.ts', '--bundle', '--platform=node', '--packages=external', '--format=esm',
  '--outfile=' + out, '--loader:.ts=ts', '--log-level=error'], { stdio: 'inherit' });
const { pickLocal, buildBackup, parseBackup, describeBackup, applyLocal, backupFileName, BACKUP_APP } = await import(out);

/** Хранилище как в браузере: порядок ключей и length/key(i) обязаны соблюдаться. */
function fakeStorage(init) {
  const map = new Map(Object.entries(init || {}));
  return {
    get length() { return map.size },
    key: (i) => Array.from(map.keys())[i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    dump: () => Object.fromEntries(map),
  };
}

console.log('\nK — резервная копия данных');

{
  const st = fakeStorage({
    'mt-chats': JSON.stringify([{ id: 'c1', title: 'Первый', messages: [{ id: 'm1', role: 'user', text: 'привет' }, { id: 'm2', role: 'assistant', text: 'и тебе' }] }]),
    'mt-theme': '"dark"',
    'mt-uid': '"u-123"',
    'чужой-ключ': 'не наше',
    'theme': 'light',
  });
  const local = pickLocal(st);
  ok('K1: в копию идут только ключи приложения (mt-*), чужие не трогаем',
    Object.keys(local).sort().join(',') === 'mt-chats,mt-theme,mt-uid', Object.keys(local).join(','));
  const b = buildBackup({ local, media: [{ id: 'm1:img:0', value: 'data:image/png;base64,AAA' }], history: [{ id: 'h1', name: 'файл.txt' }], now: Date.UTC(2026, 9, 11) });
  ok('K2: копия помечена своим приложением и версией (чужой формат узнаётся сразу)',
    b.app === BACKUP_APP && b.version >= 1 && b.exportedAt === Date.UTC(2026, 9, 11), JSON.stringify({ app: b.app, v: b.version }));
  ok('K3: байты вложений и история вложений в копии есть (без них копия бесполезна)',
    b.media.length === 1 && b.media[0].value.indexOf('data:image/png') === 0 && b.history.length === 1, JSON.stringify(b.media.length));

  const round = parseBackup(JSON.stringify(b));
  ok('K4: копия читается обратно без потерь (переписка, тема, ключ устройства)',
    round.local['mt-chats'] === local['mt-chats'] && round.local['mt-theme'] === '"dark"' && round.media.length === 1,
    JSON.stringify(Object.keys(round.local)));

  const d = describeBackup(round);
  ok('K5: человеку показывается, что внутри: чаты, сообщения, вложения, дата',
    d.chats === 1 && d.messages === 2 && d.media === 1 && d.reads === 1 && /2026/.test(d.when),
    JSON.stringify(d));
}

{
  const bad = [
    ['это не файл копии: внутри не читается ни строчки', '{обрезанный json'],
    ['это копия другого приложения', JSON.stringify({ app: 'other-app', local: { 'mt-chats': '[]' } })],
    ['в копии нет данных: файл пустой или обрезан', JSON.stringify({ app: BACKUP_APP, local: {} })],
    ['в копии чужие данные — не буду их подставлять', JSON.stringify({ app: BACKUP_APP, local: { 'чужой': 'x' } })],
  ];
  let allOk = true;
  const seen = [];
  for (const [why, text] of bad) {
    try { parseBackup(text); allOk = false; seen.push('принял: ' + why); }
    catch (e) {
      const msg = String(e && e.message);
      if (msg !== why) { allOk = false; seen.push(msg); }
    }
  }
  ok('K6: чужой файл, мусор и пустая копия отвергаются — каждый со своей понятной причиной', allOk, seen.join(' | '));
}

{
  const st = fakeStorage({ 'mt-chats': 'старое', 'mt-theme': '"light"', 'чужое': 'пусть живёт' });
  const n = applyLocal(st, { 'mt-chats': 'новое', 'mt-uid': '"u-9"', 'чужое': 'подмена' });
  const after = st.dump();
  ok('K7: замена ставит данные копии и убирает прежние ключи приложения',
    after['mt-chats'] === 'новое' && after['mt-uid'] === '"u-9"' && !('mt-theme' in after) && n === 2,
    JSON.stringify(after));
  ok('K8: ключи браузера, не принадлежащие приложению, остаются нетронутыми',
    after['чужое'] === 'пусть живёт', JSON.stringify(after));
}

{
  ok('K9: имя файла копии — с датой (видно, какая копия свежее)',
    /^metiger-копия-\d{4}-\d{2}-\d{2}\.json$/.test(backupFileName(Date.UTC(2026, 9, 11))), backupFileName(Date.UTC(2026, 9, 11)));
  ok('K10: подделка вида «браузера нет» не роняет сбор копии',
    JSON.stringify(pickLocal(null)) === '{}' && JSON.stringify(pickLocal({ length: 0 })) === '{}');
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exit(1);
