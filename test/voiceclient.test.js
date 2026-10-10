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
  console.log('\n1 ✔, 0 ✖');
} finally {
  if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
  else delete globalThis.window;
  if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
  else delete globalThis.navigator;
  globalThis.fetch = oldFetch;
}
