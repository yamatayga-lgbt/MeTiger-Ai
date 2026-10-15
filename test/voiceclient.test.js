/** Клиентская запись голоса: PCM сохраняется и точную расшифровку можно повторить. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformSync } from 'esbuild';

const dir = mkdtempSync(join(tmpdir(), 'mt-voice-client-'));
const pcmSource = readFileSync('src/lib/pcm.ts', 'utf8');
const voiceSource = readFileSync('src/lib/voice.ts', 'utf8');
const transpile = (source, name) => {
  const js = transformSync(source, { loader: 'ts', format: 'esm', target: 'node20' }).code
    .replace(/from (['"])\.\/([a-z]+)\1/g, "from './$2.mjs'");
  const file = join(dir, name);
  writeFileSync(file, js);
  return file;
};
transpile(pcmSource, 'pcm.mjs');
const voice = await import(transpile(voiceSource, 'voice.mjs'));

const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const oldFetch = globalThis.fetch;
let audio;
class FakeAudioContext {
  constructor() {
    this.sampleRate = 16000;
    this.destination = {};
    this.processor = null;
    audio = this;
  }
  createMediaStreamSource() { return { connect() {} }; }
  createScriptProcessor() {
    this.processor = { onaudioprocess: null, connect() {}, disconnect() {} };
    return this.processor;
  }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
  async close() {}
}
const track = { stopped: false, stop() { this.stopped = true; } };
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { AudioContext: FakeAudioContext },
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } },
});
let calls = 0;
globalThis.fetch = async (_url, init) => {
  calls++;
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['content-type'], 'audio/wav');
  if (calls === 1) throw new Error('offline');
  return { json: async () => ({ ok: true, text: 'Проверка, раз два.' }) };
};

/* 0.172: сторож молчащего движка браузера.
   Движок принял сессию и не сказал ни слова — раньше человек видел «Слушаю» и
   пустое поле, и починить это было нечем: серверные слои включались только после
   явной ошибки. Здесь проверяем оба конца: молчащий движок переключает работу на
   сервер, а живой — не тратит ни одного запроса (обещание 0.150 в силе). */
async function watchdogCase() {
  const pass = [];
  const run = async (RecognitionCtor) => {
    audio = undefined // иначе ждём «микрофон» от прошлой сессии, а он уже был
    let serverCalls = 0;
    const events = [];
    globalThis.fetch = async () => { serverCalls++; return { json: async () => ({ ok: true, text: 'Серверный текст.' }) } };
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { AudioContext: FakeAudioContext, SpeechRecognition: RecognitionCtor },
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { language: 'ru-RU', mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    });
    const session = voice.startVoice({
      onFinal() {}, onInterim() {}, onLevel() {}, onError() {},
      onServerLayers() { events.push('server'); },
    }, 'ru-RU');
    for (let i = 0; i < 20 && !audio?.processor; i++) await new Promise((r) => setTimeout(r, 0));
    const chunk = new Float32Array(4096).fill(0.25);
    /* 20 кадров по 4096 сэмплов при 16 кГц = 5,1 с речи: хватает и сторожу
       (4 с), и уточнению на лету (кусок 4 с). */
    /* Кадры идут с уступкой событийному циклу: живой движок успевает отдать текст
       между кадрами — так же, как в настоящем времени. */
    for (let i = 0; i < 20; i++) {
      audio.processor.onaudioprocess({ inputBuffer: { getChannelData: () => chunk } });
      await new Promise((r) => setTimeout(r, 0));
    }
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0));
    session.cancel();
    return { serverCalls, flipped: events.includes('server') };
  };
  class SilentEngine { start() {} stop() {} abort() {} }
  class TalkingEngine {
    start() {
      setTimeout(() => {
        this.onresult?.({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, 0: { transcript: 'Привет' } } } });
      }, 0);
    }
    stop() {} abort() {}
  }
  const silent = await run(SilentEngine);
  assert.equal(silent.flipped, true, 'сторож заметил молчащий движок');
  assert.ok(silent.serverCalls >= 1, 'расшифровку взял сервер, а не пустое поле');
  pass.push('✔ молчащий движок: через 4 с слово берёт сервер (запросов: ' + silent.serverCalls + ')');
  const talking = await run(TalkingEngine);
  assert.equal(talking.serverCalls, 0, 'живой движок не тратит серверные запросы');
  pass.push('✔ живой движок: сервер не дёргается ни разу (обещание 0.150)');
  return pass;
}

try {
  const events = [];
  let transcript = '';
  const session = voice.startVoice({
    onFinal() {},
    onInterim() {},
    onLevel() {},
    onError(message) { events.push(['error', message]); },
    onPolish(state, reason) { events.push([state, reason]); },
    onPolished(text) { transcript = text; events.push(['text', text]); },
  }, 'ru-RU');
  assert.ok(session, 'session starts');

  for (let i = 0; i < 20 && !audio?.processor; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.ok(audio?.processor, 'microphone PCM processor starts');
  audio.processor.onaudioprocess({
    inputBuffer: { getChannelData: () => new Float32Array(4096).fill(0.2) },
  });
  session.stop();

  for (let i = 0; i < 20 && !events.some(([state]) => state === 'fail'); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.ok(events.some(([state]) => state === 'fail'), 'first transcription reports network failure');
  assert.equal(session.canRetry(), true, 'captured audio remains available after failure');
  assert.equal(session.retry(), true, 'saved audio can be submitted again');

  for (let i = 0; i < 20 && !transcript; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(calls, 2, 'retry sends the same saved recording again');
  assert.equal(transcript, 'Проверка, раз два.', 'successful retry returns transcript for automatic insertion');
  session.cancel();
  assert.equal(track.stopped, true, 'microphone is stopped');
  console.log('  ✔ failed transcription keeps PCM; retry succeeds and returns text');
  globalThis.fetch = oldFetch;

  /* 0.188: пунктуация голосом в браузерном черновике — команды диктуются словами.
     Ноль запросов: это замена текста в поле, не служба. */
  const punct = [
    ['привет мир точка как дела запятая всё хорошо', 'привет мир. как дела, всё хорошо'],
    ['первый пункт новая строка второй пункт', 'первый пункт\nвторой пункт'],
    ['в этой точке остановимся точка', 'в этой точке остановимся.'],
    ['цена 1 запятая 5 миллиона', 'цена 1,5 миллиона'],
    ['подожди тире и поехали', 'подожди — и поехали'],
    ['wait for it period then go comma ok question mark', 'wait for it. then go, ok?'],
    ['итак точка встречаемся завтра вопросительный знак нет восклицательный знак', 'итак. встречаемся завтра? нет!'],
  ];
  for (const [given, want] of punct) {
    assert.equal(voice.punctuate(given), want, 'punctuate: ' + given);
  }
  console.log('  ✔ голосовая пунктуация: точка, запятая, тире, новая строка, вопрос и восклицание');
  assert.equal(voice.punctuate('просто слова без команд'), 'просто слова без команд', 'no commands - text unchanged');
  console.log('  ✔ без команд текст не тронут');

  const watchdog = await watchdogCase();
  for (const line of watchdog) console.log('  ' + line);
  console.log('\n' + (3 + punct.length + watchdog.length) + ' ✔, 0 ✖');
} finally {
  if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
  else delete globalThis.window;
  if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
  else delete globalThis.navigator;
  globalThis.fetch = oldFetch;
}
