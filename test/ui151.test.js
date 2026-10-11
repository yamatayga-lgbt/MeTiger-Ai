/** 0.151: предохранители от белого экрана. До этого любая ошибка рендера
 * (например, Markdown споткнулся об одно сообщение) размонтировала всё
 * приложение в пустоту, а так как переписка сохранена — белый экран
 * возвращался при каждой загрузке. Теперь: ошибка одного сообщения — плашка
 * вместо сообщения; ошибка чего угодно ещё — экран с причиной и кнопками
 * «Перезагрузить» / «Сбросить данные». */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guard = readFileSync('src/components/Guard.tsx', 'utf8');
const main = readFileSync('src/main.tsx', 'utf8');
const chat = readFileSync('src/views/ChatView.tsx', 'utf8');
const css = readFileSync('src/styles/index.css', 'utf8');
const version = readFileSync('src/lib/version.ts', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const notes = readFileSync('src/lib/release-notes.ts', 'utf8');
const readme = readFileSync('README.md', 'utf8');

const ok = (name, condition) => {
  assert.ok(condition, name);
  console.log('  ✔ ' + name);
};

const currentVersion = version.match(/APP_VERSION = '([^']+)'/)?.[1];
ok('U151a все источники версии синхронизированы между собой',
  Boolean(currentVersion && /^0\.\d{3}$/.test(currentVersion)
    && pkg.version === currentVersion && lock.version === currentVersion
    && lock.packages?.['']?.version === currentVersion));

ok('U151b последний рубеж: RootGuard ловит ошибки рендера и обёрнут вокруг <App />',
  /export class RootGuard extends Component/.test(guard)
    && /static getDerivedStateFromError/.test(guard)
    && /<RootGuard>\s*<App \/>\s*<\/RootGuard>/.test(main));

ok('U151c каждое сообщение в своём предохранителе: Guard вокруг Markdown с плашкой msg-broken',
  /export class Guard extends Component/.test(guard)
    && /<Guard fallback=/.test(chat)
    && /className="msg-broken"/.test(chat)
    && chat.indexOf('<Guard fallback=') < chat.indexOf('<Markdown text={m.text}'));

ok('U151d выход из цикла белого экрана: сброс чистит localStorage и обе базы IndexedDB',
  /localStorage\.clear\(\)/.test(guard)
    && /metiger-chat-media/.test(guard) && /metiger-attach-history/.test(guard)
    && /location\.reload\(\)/.test(guard)
    && /\.crash-screen \{/.test(css) && /\.msg-broken \{/.test(css));

ok('U151e заметка о выпуске и история README содержат 0.151',
  /version: '0\.151'/.test(notes) && /^> \*\*0\.151\*\*/m.test(readme));
