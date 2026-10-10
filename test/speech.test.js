/** Подбор голоса устройства для запасного пути озвучки по BCP-47 locale. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformSync } from 'esbuild';

const dir = mkdtempSync(join(tmpdir(), 'mt-speech-'));
const source = readFileSync('src/lib/speech.ts', 'utf8');
const code = transformSync(source, { loader: 'ts', format: 'esm', target: 'node20' }).code;
const file = join(dir, 'speech.mjs');
writeFileSync(file, code);
const { deviceVoice } = await import(file);
const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const voices = [
  { lang: 'ru-RU', name: 'Russian' },
  { lang: 'en-US', name: 'English' },
  { lang: 'zh-CN', name: 'Chinese' },
];
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { speechSynthesis: { getVoices: () => voices } },
});
try {
  const checks = [
    ['по умолчанию остаётся русский голос', deviceVoice()?.lang === 'ru-RU'],
    ['точная локаль выбирает соответствующий голос', deviceVoice('zh-CN')?.lang === 'zh-CN'],
    ['региональный вариант сопоставляется по языку', deviceVoice('en-GB')?.lang === 'en-US'],
    ['если подходящего голоса нет, чужой язык не назначается принудительно', deviceVoice('ar-SA') === null],
  ];
  for (const [name, ok] of checks) console.log(`  ${ok ? '✔' : '✖'} ${name}`);
  const failed = checks.filter((x) => !x[1]).length;
  console.log(`\n${checks.length - failed} пройдено, ${failed} провалено`);
  if (failed) process.exitCode = 1;
} finally {
  if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
  else delete globalThis.window;
  rmSync(dir, { recursive: true, force: true });
}
