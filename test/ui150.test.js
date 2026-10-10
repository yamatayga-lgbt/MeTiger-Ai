/** 0.150: речь распознаёт браузер, и его текст — финал: авто-вставка в поле,
 * без серверных моделей на пути владельца и без красного предупреждения
 * «Не удалось распознать речь… Запись сохранена» с кнопкой повтора.
 * Сервер (/api/stt) остаётся только тихим запасным путём для браузеров
 * без движка речи (например, Firefox) или когда движок умер во время записи. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const voice = readFileSync('src/lib/voice.ts', 'utf8');
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
ok('U150a все источники версии синхронизированы между собой',
  Boolean(currentVersion && /^0\.\d{3}$/.test(currentVersion)
    && pkg.version === currentVersion && lock.version === currentVersion
    && lock.packages?.['']?.version === currentVersion));

ok('U150b серверные слои включаются только без браузерного движка: ворота serverLayers = !Ctor || srDead',
  /const serverLayers = \(\) => !Ctor \|\| srDead/.test(voice)
    && /if \(!serverLayers\(\)[^)]*\)/.test(voice.slice(voice.indexOf('const flushLive')))
    && /if \(!serverLayers\(\)\) return/.test(voice.slice(voice.indexOf('const askAccurate'))));

ok('U150c красного предупреждения о связи и кнопки повтора в интерфейсе больше нет',
  !/Повторить распознавание/.test(chat) && !/voiceRetryAvailable/.test(chat)
    && !/Запись сохранена/.test(chat) && !/\.voice-retry-btn/.test(css));

ok('U150d при неудаче запасного пути — мягкая заметка, и только когда текста нет',
  /if \(!hasDraft\) setVoiceNote\(/.test(chat)
    && /\{voiceNote \? <div className="voice-note">\{voiceNote\}<\/div> : null\}/.test(chat));

ok('U150e заметка о выпуске и история README содержат 0.150',
  /version: '0\.150'/.test(notes) && /^> \*\*0\.150\*\*/m.test(readme));
