/**
 * Захват звука кусками и склейка текста (src/lib/pcm.ts, joinLive) — 0.108.
 *
 * Это тот слой, который превращает речь в самостоятельные куски WAV: без
 * проверки его ошибки видны только ухом («слова пропадают на стыках»), поэтому
 * считаем по-настоящему: прореживание, заголовок WAV, громкость, склейка.
 *
 * Запуск: node test/pcm.test.js
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformSync } from 'esbuild';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 220) : '')); }
}

/*
 * TS → JS во временную папку. Именно в папку, а не в data:-URL: voice.ts
 * импортирует './pcm', и внутри data:-URL такой относительный путь не разрешается
 * («Invalid URL»). В обычных файлах рядом друг с другом всё работает как есть.
 */
const DIR = mkdtempSync(join(tmpdir(), 'mt-ts-'));
function loadTs(file, outName) {
  const src = readFileSync(file, 'utf8');
  const js = transformSync(src, { loader: 'ts', format: 'esm', target: 'node20' }).code
    /* esbuild выдаёт кавычки как получится — сносим и одинарные, и двойные. */
    .replace(/from (['"])\.\/([a-z]+)\1/g, "from './$2.mjs'");
  const out = join(DIR, outName);
  writeFileSync(out, js);
  return out;
}
const pcmPath = loadTs('src/lib/pcm.ts', 'pcm.mjs');
const voicePath = loadTs('src/lib/voice.ts', 'voice.mjs');
const pcm = await import(pcmPath);
const voice = await import(voicePath);

console.log('PCM — куски звука для уточнения на лету');
{
  /* 48 кГц → 16 кГц: три сэмпла в один. Синус 480 Гц за 100 мс — это 48 периодов. */
  const inRate = 48000, outRate = 16000, ms = 100;
  const input = new Float32Array((inRate * ms) / 1000);
  for (let i = 0; i < input.length; i++) input[i] = Math.sin((2 * Math.PI * 480 * i) / inRate) * 0.5;
  const out = pcm.downsample(input, inRate, outRate);
  ok('P1: прореживание даёт ровно треть сэмплов (48 → 16 кГц)', out.length === input.length / 3, `${input.length} → ${out.length}`);
  /* Считаем переходы через ноль: у 480 Гц за 100 мс их должно быть около 96. */
  let zc = 0;
  for (let i = 1; i < out.length; i++) if ((out[i - 1] < 0) !== (out[i] < 0)) zc++;
  ok('P2: сигнал не «поплыл» — частота на выходе та же (переходов через ноль ≈ 96)', Math.abs(zc - 96) <= 4, 'переходов ' + zc);
  ok('P3: громкость сохраняется (пик около половины шкалы)', Math.abs(pcm.peakOf(out) - 0.5) < 0.08, String(pcm.peakOf(out)));
}
{
  const quiet = new Int16Array(16000); // секунда тишины
  const loud = new Int16Array(16000).fill(9000);
  ok('P4: тишина отличается от речи (по этому признаку куски не отправляем зря)',
    pcm.peakOf(quiet) < 0.02 && pcm.peakOf(loud) > 0.2, `${pcm.peakOf(quiet)} / ${pcm.peakOf(loud)}`);
}
{
  /* Заголовок WAV разбираем по байтам: если он врёт, сервер не прочитает файл. */
  const samples = new Int16Array([0, 1000, -1000, 32767, -32768]);
  const blob = pcm.encodeWav(samples);
  const buf = Buffer.from(await blob.arrayBuffer());
  const ascii = (o, n) => buf.subarray(o, o + n).toString('ascii');
  ok('P5: заголовок WAV — RIFF/WAVE/fmt/data, моно, 16 бит, 16 кГц',
    ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE' && ascii(12, 4) === 'fmt ' && ascii(36, 4) === 'data'
      && buf.readUInt16LE(20) === 1 && buf.readUInt16LE(22) === 1 && buf.readUInt16LE(34) === 16 && buf.readUInt32LE(24) === 16000,
    `${ascii(0, 4)}/${ascii(8, 4)}/${ascii(12, 4)}/${ascii(36, 4)}`);
  ok('P6: длины в заголовке сходятся с данными (иначе провайдер режет хвост)',
    buf.readUInt32LE(40) === samples.length * 2 && buf.readUInt32LE(4) === 36 + samples.length * 2 && buf.length === 44 + samples.length * 2,
    `data=${buf.readUInt32LE(40)} riff=${buf.readUInt32LE(4)} всего=${buf.length}`);
  const back = new Int16Array(buf.buffer, buf.byteOffset + 44, samples.length);
  ok('P7: сэмплы не испортились по дороге (знак не потерян)',
    back[0] === 0 && back[1] === 1000 && back[2] === -1000 && back[3] === 32767 && back[4] === -32768,
    Array.from(back).join(','));
  ok('P8: тип файла назван честно — audio/wav', blob.type === 'audio/wav', blob.type);
}
{
  /* Склейка кусков: стык повторяет слово (и не одно) — повтор убираем. */
  const j = voice.joinLive;
  ok('P9: повтор слова на стыке убирается', j('мы обсудили голос', 'голос и ввод') === 'и ввод', j('мы обсудили голос', 'голос и ввод'));
  ok('P10: повтор двух слов на стыке тоже убирается', j('проверка уточнения на лету', 'на лету текст идёт') === 'текст идёт', j('проверка уточнения на лету', 'на лету текст идёт'));
  ok('P11: знаки и регистр не мешают узнать слово', j('Привет, мир!', 'Мир как дела') === 'как дела', j('Привет, мир!', 'Мир как дела'));
  ok('P12: без повтора текст не режется', j('первое предложение', 'второе предложение') === 'второе предложение', j('первое предложение', 'второе предложение'));
  ok('P13: пустые входы не ломают склейку', j('', 'начало') === 'начало' && j('хвост', '') === '');
  ok('P14: composed/decomposed диакритика совпадает только при удалении повтора',
    j('Cafe\u0301 monde', 'Café monde! après') === 'après', j('Cafe\u0301 monde', 'Café monde! après'));
  ok('P15: белорусский язык распознавания не подменяется русским',
    voice.voiceLang('be-BY') === 'be-BY' && voice.voiceLangShort('be-BY') === 'be',
    voice.voiceLang('be-BY') + '/' + voice.voiceLangShort('be-BY'));
  ok('P16: регион браузера сохраняется для голоса ввода (en-GB, zh-TW, pt-BR)',
    voice.voiceLang('en-GB') === 'en-GB' && voice.voiceLang('zh-TW') === 'zh-TW'
      && voice.voiceLang('pt-BR') === 'pt-BR' && voice.voiceLang('en_US') === 'en-US',
    [voice.voiceLang('en-GB'), voice.voiceLang('zh-TW'), voice.voiceLang('pt-BR'), voice.voiceLang('en_US')].join('/'));
}

console.log('\n' + pass + ' пройдено, ' + fail + ' провалено');
if (fail) process.exitCode = 1;
