/**
 * 🔓 Bypass — авторазблокировка и обход ссылок (1.0.156)
 *
 * Обход lootlabs.gg, loot-link.com, linkvertise.com, work.ink, adf.ly, bit.ly и других
 */

'use strict';
import { S } from './helpers.js';

export default [
  S('bypass-lootlabs', 'web', 'Обход LootLabs', 'Разблокировка ссылок lootlabs.gg, loot-link',
    /(обойди|разблокируй|bypass).*(lootlabs|loot-link|lootlinks)|lootlabs.*(обход|bypass|разблок)|https?:\/\/links\.lootlabs\.gg\/s\?/i, {
      priority: 9,
      tools: ['bypass'],
      prompt: 'обход LootLabs — ОБЯЗАТЕЛЬНО используй инструмент bypass с url из сообщения. Инструмент делает полный обход: WebSocket, AES-GCM, WebGL PoW, получает финальный URL без заданий. В ответе дай: исходная ссылка, финальная кликабельная синяя [финальная](https://...), метод, если есть ключ — покажи. Если bypass не удался из-за Turnstile капчи — дай ручные сервисы: bypass.city, lootdest.org, bypass.vip. Для Delta Executor ключей — финальная ссылка даст ключ'
    }),

  S('bypass-linkvertise', 'web', 'Обход Linkvertise', 'Разблокировка linkvertise.com',
    /(обойди|разблокируй|bypass).*(linkvertise)|linkvertise.*(обход|bypass)/i, {
      priority: 9,
      tools: ['bypass'],
      prompt: 'обход Linkvertise — используй bypass инструмент с url из сообщения. Linkvertise — монетизированная ссылка с заданиями, инструмент обходит её через редиректы, meta refresh и JS location, возвращает финальную ссылку без выполнения заданий. В ответе дай исходную, финальную кликабельную синюю [финальная](https://...), метод. Если не удалось — дай ручные сервисы bypass.city, lootdest.org'
    }),

  S('bypass-workink', 'web', 'Обход Work.ink', 'Разблокировка work.ink',
    /(обойди|разблокируй|bypass).*(work\.ink)|work\.ink.*(обход|bypass)/i, {
      priority: 9,
      tools: ['bypass'],
      prompt: 'обход Work.ink — используй bypass инструмент с url. Work.ink — популярный шортенер с заданиями, инструмент обходит через HTTP редиректы, meta refresh, JS location, возвращает финальную ссылку без заданий. Верни финальную как кликабельную синюю [url](https://...), исходную и метод. Если не удалось — дай bypass.city'
    }),

  S('bypass-generic', 'web', 'Авторазблокировка ссылок', 'Обход любых коротких/монетизированных ссылок',
    /(обойди.*ссылку|разблокируй.*ссылку|bypass.*link|обход.*ссылок|авторазблокировка|коротк.*ссылк.*обойди|adf\.ly|bit\.ly|tinyurl|short.*link)/i, {
      priority: 8,
      tools: ['bypass', 'page'],
      prompt: 'авторазблокировка ссылок — универсальный обход. Используй bypass инструмент для любой короткой или монетизированной ссылки (lootlabs, linkvertise, work.ink, adf.ly, bit.ly и т.д.). Инструмент следует редиректам, meta refresh, JS location, для LootLabs — WebSocket обход. Верни финальную ссылку как кликабельную синюю [текст](https://...), исходную и метод. Если не удалось — дай ручные сервисы bypass.city, lootdest.org'
    }),
];
