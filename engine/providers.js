/**
 * Провайдеры бесплатных моделей — порт движка MeTiger (Этап 1 переноса из Yama AI).
 *
 * Таблица снята с живого движка Yama (1.0.228), а не написана заново: списки моделей
 * там сверены с каталогами провайдеров, мёртвые id вычищены, лимиты подобраны по
 * фактическим 429. Меняется одно: конфиг не читает process.env в момент импорта —
 * в Cloudflare Worker нет процессa, поэтому всё, что зависит от окружения (ключи,
 * id аккаунта, локальный сервер), передаётся в buildTable(env) на каждом запросе.
 *
 *   env: { GROQ_KEYS, CLOUDFLARE_ACCOUNT_ID, LOCAL_BASE_URL, ... }
 *
 * Ключей в файле нет и не будет: только имена переменных.
 */

/* Пауза между запросами к одному провайдеру, чтобы не словить СВОЙ 429.
   Снято с прода Yama: OdiRouter отвечает 429 уже на 6 запросе в минуту. */
export const MIN_INTERVAL = {
  mistral: 400,
  odirouter: 4000,
  atria: 700,
  sharellm: 400,
};

/* Сколько картинок реально доезжает до модели: больше — обрыв/дорого. */
export const MAX_IMAGES = 2;

/* Потолок ожидания одного провайдера: быстрый не должен ждать медленного. */
export const TIMEOUT = { fast: 25000, smart: 60000 };

/* Пулы моделей сверяются с ЖИВЫМ api провайдера, а не с памятью: id уезжают в
   400/404 молча, и тогда половина очереди — мёртвые строки, которые только
   жгут квоту и время совета. Проверка (2026-09-30): у gemini нет gemini-2.5-pro
   («no longer available to new projects»), у z.ai нет glm-5-flash и glm-5.2-flash.
   Перепроверять так: GET /v1beta/models (gemini) и GET /api/paas/v4/models (z.ai),
   плюс один пробный запрос на id — 404/«Unknown Model» значит «id больше нет». */

export const TABLE = {
  gemini: {
    label: "Google Gemini",
    kind: "gemini",
    base: "https://generativelanguage.googleapis.com/v1beta",
    envPrefix: 'GEMINI',
    limit: 250,
    models: {
      fast: ["gemini-2.5-flash","gemini-3.5-flash","gemini-3.6-flash","gemini-3.1-flash-lite","gemini-flash-lite-latest","gemma-4-26b-a4b-it"],
      smart: ["gemini-3.5-flash","gemma-4-31b-it"],
    },
  },
  groq: {
    label: "Groq",
    kind: "openai",
    base: "https://api.groq.com/openai/v1",
    envPrefix: 'GROQ',
    limit: 1000,
    models: {
      /* Порядок пулов groq подобран замером, а не каталогом (01.10.2026, три вопроса
         каждому id: «привет», «как меня зовут» с фактом в system, «17×3»):
           qwen/qwen3.8-27b   — чисто по-русски, «Тебя зовут Тигр, ты из Гомеля.», 51 ✓
           openai/gpt-oss-20b — чисто, но при маленьком max_tokens отдаёт пустой контент
                                (весь бюджет съедает рассуждение), поэтому вторым
           allam-2-7b         — сыплет арабским («17 مضروبًا في 3»), Гомель записал в
                                Московскую область. В быстром пуле её быть не должно:
                                modelsPerProvider = 2, и две попытки из двух уходили на неё.
           groq/compound, groq/compound-mini — на этом ключе model_not_found (400),
                                мёртвый id в очереди только сжигает запрос.
         Отсюда: первая модель в fast = та, что реально годится для русского ответа. */
      fast: ["qwen/qwen3.8-27b","openai/gpt-oss-20b"],
      smart: ["openai/gpt-oss-120b","qwen/qwen3.8-27b","openai/gpt-oss-20b"],
    },
  },
  mistral: {
    label: "Mistral",
    kind: "openai",
    base: "https://api.mistral.ai/v1",
    envPrefix: 'MISTRAL',
    limit: 1000,
    models: {
      fast: ["ministral-3b-2512","ministral-8b-2512","codestral-2508"],
      smart: ["ministral-14b-2512"],
    },
  },
  openrouter: {
    label: "OpenRouter",
    kind: "openai",
    base: "https://openrouter.ai/api/v1",
    envPrefix: 'OPENROUTER',
    limit: 50,
    models: {
      fast: ["nex-agi/nex-n2.5-mini:free","inclusionai/ling-3.0-flash-vl:free","liquid/lfm-2.5-2.6b:free","qwen/qwen3.8-27b:free","dots-studio/dots-3-note-preview:free","cohere/north-mini-code:free","nex-agi/nex-n2.5-pro:free","inclusionai/ling-3.0-flash-sante:free","inclusionai/ling-3.0-flash-fin:free","poolside/laguna-xs-2.1:free","nvidia/nemotron-3.5-lightning:free","openrouter/free"],
      smart: ["nvidia/nemotron-3-ultra-550b-a55b:free","nvidia/nemotron-3-super-120b-a12b:free","nex-agi/nex-n2.5-pro:free","nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free","dots-studio/dots-3-note-preview:free","google/gemma-4-31b-it:free","z-ai/glm-5.2:free","poolside/laguna-s-2.1:free","openrouter/free"],
    },
  },
  cloudflare: {
    label: "Cloudflare Workers AI",
    kind: "openai",
    base: "https://api.cloudflare.com/client/v4/accounts/{acc}/ai/v1",
    envPrefix: 'CLOUDFLARE',
    limit: 1000,
    models: {
      fast: ["@cf/meta/llama-3.2-1b-instruct","@cf/meta/llama-3.2-3b-instruct","@cf/meta/llama-3.1-8b-instruct-fp8","@cf/ibm-granite/granite-4.0-h-micro","@cf/google/gemma-4-26b-a4b-it","@cf/openai/gpt-oss-20b","@cf/qwen/qwen3-30b-a3b-fp8","@cf/zai-org/glm-4.7-flash"],
      smart: ["@cf/meta/llama-3.3-70b-instruct-fp8-fast","@cf/meta/llama-4-scout-17b-16e-instruct","@cf/openai/gpt-oss-120b","@cf/nvidia/nemotron-3-120b-a12b","@cf/mistralai/mistral-small-3.1-24b-instruct","@cf/qwen/qwen3.8-27b","@cf/deepseek-ai/deepseek-r1-distill-qwen-32b","@cf/qwen/qwen2.5-coder-32b-instruct","@cf/qwen/qwq-32b","@cf/aisingapore/gemma-sea-lion-v4-27b-it"],
    },
  },
  xkiro: {
    label: "Xkiro",
    kind: "openai",
    base: "https://api.xkiro.com/v1",
    envPrefix: 'XKIRO',
    limit: 1000,
    models: {
      fast: ["qwen/qwen3.7-flash:free","qwen/qwen3.5-flash:free","qwen/qwen3.6-27b:free","qwen/qwen3.6-35b-a3b:free","qwen/qwen3-omni-flash:free","qwen/qwen3.5-omni-flash:free","qwen/qwen3.8-omni-flash:free","mistralai/ministral-8b","mistralai/ministral-3b","mistralai/ministral-14b","sensenova/sensenova-6.8-flash-lite","sensenova/sensenova-6.7-flash-lite"],
      smart: ["qwen/qwen3.8-max:free","qwen/qwen3.7-max:free","qwen/qwen3.6-max-preview:free","qwen/qwen3-max:free","qwen/qwen3.7-plus:free","qwen/qwen3.6-plus:free","qwen/qwen3.5-plus:free","qwen/qwen3.5-397b-a17b:free","qwen/qwen-plus-2025-07-28:free","mistralai/mistral-large-2512","mistralai/mistral-medium-3.5","mistralai/mistral-small-2603","mistralai/devstral-medium","mistralai/codestral-2508","qwen/qwen3-coder-plus:free","qwen/qwen3.5-omni-plus:free","qwen/qwen3-vl-plus:free"],
    },
  },
  zai: {
    label: "Z.AI",
    kind: "openai",
    base: "https://api.z.ai/api/paas/v4",
    envPrefix: 'ZAI',
    limit: 1000,
    models: {
      fast: ["glm-4.7-flash","glm-4.5-flash","glm-4.6v-flash","glm-5.3-flash"],
      smart: ["glm-4.7-flash","glm-5.3-flash","glm-4.5-flash","glm-4.6v-flash","glm-5.3","glm-5"],
    },
  },
  atria: {
    label: "Atria ASI",
    kind: "openai",
    base: "https://api.atria-asi.ai/v1",
    envPrefix: 'ATRIA',
    limit: 1000,
    models: {
      fast: ["Atria-Dawn-Preview"],
      smart: ["Atria-Dawn-Preview"],
    },
  },
  sharellm: {
    label: "ShareLLM",
    kind: "openai",
    base: "https://sharellm.net/v1",
    envPrefix: 'SHARELLM',
    limit: 600,
    models: {
      fast: ["auto-balanced","auto-efficient","auto-smart"],
      smart: ["auto-smart","auto-balanced","auto-efficient"],
    },
  },
  odirouter: {
    label: "OdiRouter",
    kind: "openai",
    base: "https://api.odirouter.ai/v1",
    envPrefix: 'ODIROUTER',
    limit: 1000,
    models: {
      fast: ["free-gemini-3.1-flash-lite","free-qwen3.5-plus","free-qwen3.5-flash","qwen3.5-flash","gemini-3.1-flash-lite"],
      smart: ["gemini-3.5-flash","deepseek-v4-pro","deepseek-v4-flash"],
    },
  },
};

/* Порядок обхода: от самого быстрого/надёжного к запасным. Локальная голова —
   последней: она не должна вытеснять облачную, но обязана попадать в совет голосов. */
export const ORDER = {
  /* Cerebras убран целиком (0.094): провайдер стал платным, а продукт бесплатный.
     Мёртвый провайдер в очереди — это не «на всякий случай», а лишняя попытка
     и лишняя строка в отчёте о том, кто отказал. */
  fast: ['groq', 'cloudflare', 'gemini', 'zai', 'openrouter', 'mistral', 'xkiro', 'atria', 'sharellm', 'odirouter'],
  smart: ['groq', 'zai', 'cloudflare', 'openrouter', 'gemini', 'mistral', 'xkiro', 'atria', 'odirouter', 'sharellm'],
};

/* Картинка: зрячие первыми. */
export const VISION_FIRST = ['odirouter', 'gemini', 'openrouter', 'xkiro'];

/**
 * Ключи провайдера из окружения. Имена перебираются по образцу Yama:
 * XXX_KEYS / XXX_KEY / XXX_KEYS_1..20 — чтобы можно было докладывать ключи
 * пачкой или по одному, не правя код.
 */
export function envKeys(env, upper) {
  const names = [upper + '_KEYS', upper + '_KEY'];
  for (let i = 1; i <= 20; i++) { names.push(upper + '_KEYS_' + i, upper + '_KEY_' + i); }
  const out = [];
  for (const n of names) {
    for (const part of String((env && env[n]) || '').split(',')) {
      const v = part.trim();
      if (v && out.indexOf(v) < 0) out.push(v);
    }
  }
  return out;
}

/** Живая таблица на конкретное окружение. Без ключей провайдера просто нет. */
export function buildTable(env) {
  const out = {};
  for (const id of Object.keys(TABLE)) {
    const c = TABLE[id];
    const keys = envKeys(env, c.envPrefix);
    out[id] = {
      id, label: c.label, kind: c.kind, keys, limit: c.limit, models: c.models,
      base: c.base,
      account: (env && env.CLOUDFLARE_ACCOUNT_ID) || '',
    };
  }
  return out;
}

/** Есть ли у провайдера живой ключ и не исчерпана ли квота. */
export function providerAlive(P, id, health) {
  const cfg = P[id];
  if (!cfg || !cfg.keys || !cfg.keys.length) return false;
  if (cfg.kind === 'openai' && cfg.base.indexOf('{acc}') >= 0 && !cfg.account) return false;
  const now = Date.now();
  for (let i = 0; i < cfg.keys.length; i++) {
    const k = (health && health[id] && health[id][i]) || null;
    if (k) {
      if (k.state === 'invalid') continue;
      if (k.state === 'cool' && now < (k.until || 0)) continue;
      if (k.state === 'day' && now - (k.deadAt || 0) <= 26 * 3600e3) continue;
      if ((k.used || 0) >= (cfg.limit || 0) && k.state !== 'day') continue;
    }
    return true;
  }
  return false;
}

/** Самый разгруженный живой ключ — ротация, а не «первый, который отвечает». */
export function pickKey(P, id, health) {
  const cfg = P[id];
  if (!cfg || !cfg.keys.length) return -1;
  let best = -1, bestUsed = Infinity;
  for (let i = 0; i < cfg.keys.length; i++) {
    const k = (health && health[id] && health[id][i]) || null;
    if (k && (k.state === 'invalid' || (k.state === 'cool' && Date.now() < (k.until || 0)))) continue;
    const used = (k && k.used) || 0;
    if (used < bestUsed) { bestUsed = used; best = i; }
  }
  return best < 0 ? 0 : best;
}

export function orderFor(tier, P, opts) {
  const base = (ORDER[tier] || ORDER.fast).slice();
  let o = base;
  if (opts && opts.images && opts.images.length) {
    const first = VISION_FIRST.filter((x) => o.indexOf(x) >= 0);
    o = first.concat(o.filter((x) => first.indexOf(x) < 0));
  }
  if (opts && (opts.only || opts.forceModel)) o = [opts.only || 'openrouter'];
  /* только живые: мёртвый провайдер в очереди — это потерянные секунды на таймаут */
  const alive = o.filter((id) => providerAlive(P, id, opts && opts.health));
  return (alive.length ? alive : o).concat((opts && opts.alsoLive) || []);
}
