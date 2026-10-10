/** 0.140: 30 символов в названиях чатов и повтор голосовой расшифровки. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const persist = readFileSync('src/lib/persist.ts', 'utf8');
const sidebar = readFileSync('src/components/Sidebar.tsx', 'utf8');
const topbar = readFileSync('src/components/Topbar.tsx', 'utf8');
const cases = readFileSync('src/components/CaseEditorModal.tsx', 'utf8');
const chat = readFileSync('src/views/ChatView.tsx', 'utf8');
const voice = readFileSync('src/lib/voice.ts', 'utf8');
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
ok('U140a все источники версии синхронизированы на 0.140',
  currentVersion === '0.140' && pkg.version === currentVersion && lock.version === currentVersion
    && lock.packages?.['']?.version === currentVersion);
ok('U140b автогенерация и переименование чатов ограничены 30 символами',
  /TITLE_MAX = 30/.test(app) && /maxLength=\{30\}/.test(sidebar) && /maxLength=\{30\}/.test(topbar));
ok('U140c старые и сохраняемые названия чатов тоже обрезаются до 30',
  /MAX_CHAT_TITLE = 30/.test(persist) && (persist.match(/title: safeChatTitle\(c\.title\)/g) || []).length >= 2);
ok('U140d лимит названия дела остаётся 50', /maxLength=\{50\}/.test(cases));
ok('U140e сессия голоса хранит аудио и предоставляет повтор распознавания',
  /canRetry: \(\) => boolean/.test(voice) && /retry: \(\) => boolean/.test(voice)
    && /retry\(\)\s*\{\s*if \(!hasRetryableRecording\(\) \|\| polishBusy\) return false[\s\S]*?transcribeAll\(\)/.test(voice));
const stopInput = chat.slice(chat.indexOf('const stopVoiceInput ='), chat.indexOf('const cancelVoiceInput ='));
ok('U140f остановка сохраняет сессию до точного ответа, ошибка включает повтор',
  /session\.stop\(\)/.test(stopInput) && !/sessionRef\.current = null/.test(stopInput)
    && /sessionRef\.current\?\.canRetry\(\)/.test(chat)
    && /Повторить распознавание/.test(chat));
ok('U140g успешный повтор автоматически кладёт текст в поле и освобождает запись',
  /onPolished: \(text\) => \{[\s\S]*?sessionRef\.current = null[\s\S]*?setValue\(composed\)/.test(chat));
ok('U140h зависший запрос расшифровки прерывается таймаутом',
  /setTimeout\(\(\) => request\.abort\(\), POLISH_MS\)/.test(voice));
ok('U140i кнопка повтора оформлена и доступна через live-region',
  /className="voice-error" role="status" aria-live="polite"/.test(chat)
    && /\.voice-retry-btn\s*\{/.test(css));
ok('U140j заметка о выпуске и история README содержат 0.140',
  /version: '0\.140'[\s\S]*?title: 'Чаты короче, голос можно распознать повторно'/.test(notes)
    && /^> \*\*0\.140\*\*/m.test(readme));

console.log('\n10 ✔, 0 ✖');
