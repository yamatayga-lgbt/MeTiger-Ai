/**
 * Локальный запуск двигателя (Этап 1).
 *
 * Поднимается РОВНО тот обработчик, что работает в Pages Function
 * (`functions/api/chat.js`) — только завёрнут в http-сервер Node. Так проверка
 * «у меня локально ответило» означает «на проде тоже ответит», а не «у нас два
 * разных API, и рабочий тот, который ближе».
 *
 *   npm run api   → http://127.0.0.1:8788  (POST /api/chat)
 *   npm run dev   → фронт на 5173 с прокси /api сюда
 *
 * Ключи читаются из `.dev.vars` (формат Cloudflare: KEY=value) и из окружения.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { onRequestPost, onRequestGet, onRequestOptions } from '../functions/api/chat.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** .dev.vars → env. То, что уже стоит в окружении, не перетирается. */
function loadEnv() {
  const env = { ...process.env };
  const file = join(root, '.dev.vars');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const env = loadEnv();

/**
 * Локальное хранилище ПАМЯТИ (Этап 3): тот же контракт, что у связки KV на проде
 * (get отдаёт разобранный JSON, put принимает строку), только на файлах.
 * Это не «упрощённая память для разработки»: обработчик и движок те же самые,
 * отличается только то, где лежат байты — иначе «локально работает» ничего не значит.
 */
function fileKV(dirName) {
  const dir = join(root, dirName);
  const pathFor = (key) => join(dir, key.replace(/[^a-zA-Z0-9_.-]/g, '_') + '.json');
  return {
    async get(key) {
      try {
        return JSON.parse(readFileSync(pathFor(key), 'utf8'));
      } catch (e) {
        return null;
      }
    },
    async put(key, value) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(pathFor(key), typeof value === 'string' ? value : JSON.stringify(value));
    },
    async delete(key) {
      try {
        unlinkSync(pathFor(key));
      } catch (e) {}
    },
  };
}

if (!env.MEMORY) env.MEMORY = fileKV('.mt-memory');
const port = Number(process.env.PORT || 8788);

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const reply = async (r) => {
      res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
      res.end(await r.text());
    };
    try {
      const request = new Request('http://127.0.0.1' + (req.url || '/'), {
        method: req.method,
        headers: req.headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
      });
      const context = { request, env, waitUntil: () => {} };
      const path = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      if (req.method === 'OPTIONS') return reply(await onRequestOptions(context));
      if (path === '/api/chat') {
        return reply(req.method === 'GET' ? await onRequestGet(context) : await onRequestPost(context));
      }
      return reply(new Response(JSON.stringify({
        ok: true, routes: ['POST /api/chat', 'GET /api/chat'],
        alive: Object.keys(env).filter((k) => /_KEYS?$/.test(k)).map((k) => k.replace(/_KEYS?$|_KEY$/, '').toLowerCase()),
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    } catch (e) {
      return reply(new Response(JSON.stringify({ ok: false, error: String((e && e.message) || e) }), {
        status: 500, headers: { 'content-type': 'application/json' },
      }));
    }
  });
}).listen(port, '0.0.0.0', () => {
  const keys = Object.keys(env).filter((k) => /_KEYS?$/.test(k));
  console.log('MeTiger Ai · движок: http://0.0.0.0:' + port + '/api/chat');
  console.log(keys.length ? 'провайдеры с ключами: ' + keys.map((k) => k.replace(/_KEYS?$|_KEY$/, '').toLowerCase()).join(', ') :
    'ключей нет — движок ответит 503 со списком попыток (это правильное поведение, а не поломка)');
});
