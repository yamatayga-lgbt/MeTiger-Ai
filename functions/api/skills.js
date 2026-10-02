/**
 * GET /api/skills — что агент умеет по смыслу вопроса (данные engine/skills.js).
 *
 *     curl 'https://…/api/skills'                 — реестр и сводка
 *     curl 'https://…/api/skills?q=посчитай'      — что включится на такой вопрос
 *
 * Смысл эндпоинта один: «навыки» — не магия, а правила в промпте. Здесь видно,
 * какие именно, сколько их влезает в ответ и почему часть выключена.
 */
import { SKILLS, stats, detect } from '../../engine/skills.js';
import { sharedImggen } from '../../engine/imggen.js';

const CORS = {
  'access-control-allow-origin': '*',
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: CORS });

export async function onRequestGet(context) {
  const q = String((context.request && context.request.url) || '');
  const m = /[?&]q=([^&]*)/.exec(q);
  const ask = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')).slice(0, 600) : '';
  /* Готовность инструмента — из того же зеркала, что и у чата (кэш на изолят). */
  const ready = { imggen: sharedImggen(context.env).status().sources.some((x) => x.ready) };
  return json({
    ok: true,
    ...stats({ imgToolReady: ready }),
    items: SKILLS.map((s) => ({
      id: s.id,
      cat: s.cat,
      title: s.title,
      desc: s.desc,
      tools: s.need,
      always: !!s.always,
      priority: Number(s.priority) || 0,
      off: s.off || null,
    })),
    /* что включится именно на этот вопрос — той же функцией, что и в бою */
    onAsk: ask ? detect(ask, { env: context.env, imgToolReady: ready }).map((s) => ({ id: s.id, title: s.title, tools: s.tools, offTools: s.offTools })) : undefined,
  });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
