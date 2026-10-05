/**
 * Запасной вход для сетей, где провайдер режет *.pages.dev целиком по SNI
 * (Россия — с мая 2024, похожая картина у части белорусских провайдеров):
 * TLS обрывается по ИМЕНИ ДОМЕНА ещё до того, как браузер коснётся сайта —
 * дело не в этом приложении, так рвётся ЛЮБОЙ сайт на pages.dev одинаково.
 * Подтверждено публично: community.cloudflare.com и ntc.party фиксируют
 * массовую блокировку *.pages.dev у провайдеров начиная с мая 2024.
 *
 * Это обычный Cloudflare Worker на бесплатном *.workers.dev — другое имя
 * домена, которое (пока) не в тех же списках блокировки. Он прозрачно
 * пробрасывает каждый запрос на настоящий деплой (metiger-ai.pages.dev) и
 * отдаёт ответ как есть, включая потоковые SSE-ответы /api/chat — без
 * буферизации, кусок за куском, как будто пользователь обратился напрямую.
 *
 * Это НЕ инструмент обхода цензуры конкретного контента — здесь нечего
 * обходить: правило блокирует домен целиком по имени, без разбора, что на
 * нём лежит. Переезд на другое имя — тот же приём, которым Cloudflare сама
 * советует пользоваться (свой домен вместо общего pages.dev), просто решение
 * без наличия купленного домена здесь и сейчас — бесплатная и временная мера,
 * а не постоянная (см. README: «постоянный выход» — свой домен на проекте).
 */

/** Домен настоящего деплоя — единственное место, которое нужно поменять,
    если проект когда-нибудь переедет на свой домен. */
const UPSTREAM = 'https://metiger-ai.pages.dev';

/**
 * У бэкенда (functions/api/chat.js) есть вежливый троттлинг по IP человека.
 * Без этого заголовка весь трафик через обход выглядел бы одним IP — самим
 * воркером — и один активный человек мог бы «выесть» лимит у всех остальных,
 * идущих тем же путём. Секрет — МЯГКАЯ защита (как и X-Forwarded-For на той
 * стороне): не граница безопасности, а просто чтобы заголовок не подделывали
 * от скуки, если слать запросы на pages.dev напрямую.
 */
const PROXY_SECRET = 'mt-proxy-v1-9f3c2a7e1b4d6f80';

/** Заголовки, которые нельзя слепо копировать дальше — либо про САМ транспорт
    (их выставляет fetch заново), либо раскрыли бы, что это Worker, а не сам сайт. */
const DROP_REQUEST_HEADERS = ['host', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor'];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const upstreamUrl = UPSTREAM + url.pathname + url.search;

    const headers = new Headers(request.headers);
    for (const h of DROP_REQUEST_HEADERS) headers.delete(h);

    // Подлинный IP видим именно здесь, на входе в ЭТОТ Worker — Cloudflare сама
    // его проставляет и не даёт подделать на этом хопе. Дальше несём его сами.
    const realIp = request.headers.get('cf-connecting-ip');
    if (realIp) {
      headers.set('x-mt-proxy-ip', realIp);
      headers.set('x-mt-proxy-secret', PROXY_SECRET);
    }

    const hasBody = !(request.method === 'GET' || request.method === 'HEAD');
    const upstreamRequest = new Request(upstreamUrl, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      // ReadableStream-тело запроса (POST /api/chat с вложениями) требует duplex
      // в современном fetch — без него Workers runtime откажет на старте запроса.
      duplex: hasBody ? 'half' : undefined,
      // Редиректы разворачиваем ЗДЕСЬ, внутри Cloudflare: иначе Location мог бы
      // указать браузеру на сам pages.dev — то есть ровно туда, что заблокировано.
      redirect: 'follow',
    });

    const res = await fetch(upstreamRequest);

    const outHeaders = new Headers(res.headers);
    // На всякий случай — если апстрим когда-нибудь всё же отдаст относительный
    // или абсолютный Location на pages.dev, не пропускаем его к браузеру как есть.
    const loc = outHeaders.get('location');
    if (loc && loc.includes('pages.dev')) {
      outHeaders.set('location', loc.replace(UPSTREAM, ''));
    }

    // Тело НЕ читается и не копится в памяти — пробрасывается потоком как есть,
    // поэтому стриминг ответа (SSE черновики /api/chat) доходит кусками, а не
    // одним куском в конце.
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: outHeaders,
    });
  },
};
