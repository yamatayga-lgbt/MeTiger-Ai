/**
 * Конструктор навыка и список категорий (перенос из донора yama-ai/skills/helpers.js).
 * S() — конструктор навыка, CATS — список категорий.
 */
'use strict';

const CATS = [
  { id: 'reasoning', title: '\uD83E\uDDE0 Рассуждение' },
  { id: 'comm', title: '\uD83D\uDCAC Общение' },
  { id: 'research', title: '\uD83D\uDD0D Исследование' },
  { id: 'intel', title: '\uD83D\uDEE0 Ядро (переходное)' },
  { id: 'knowledge', title: '\uD83D\uDCDA Знания' },
  { id: 'memory', title: '\uD83E\uDDE0 Память' },
  { id: 'coding', title: '\uD83D\uDCBB Coding' },
  { id: 'web', title: '\uD83C\uDF10 Web & Browser' },
  { id: 'files', title: '\uD83D\uDCC4 Files' },
  { id: 'vision', title: '\uD83D\uDC41\uFE0F Vision' },
  { id: 'editing', title: '\uD83C\uDFA8 Image Editing' },
  { id: 'diagnostics', title: '\uD83E\uDDE9 Self-Diagnostics' },
  { id: 'control', title: '\uD83C\uDF9B Agent Control' },
  { id: 'search', title: 'Поиск и информация' },
  { id: 'text', title: 'Тексты и язык' },
  { id: 'code', title: 'Код и расчёты' },
  { id: 'plan', title: 'Планы и задачи' },
  { id: 'problem', title: '🧩 Решение проблем' },
  { id: 'decision', title: '⚖️ Принятие решений' },
  { id: 'reading', title: '📖 Чтение документов' },
  { id: 'stats', title: '📊 Статистика и аналитика' },
  { id: 'arch', title: '🏗 Архитектура ПО' },
  { id: 'debug', title: '🐞 Отладка кода' },
  { id: 'testing', title: '🧪 Тестирование' },
  { id: 'devops', title: '⚙️ Инфраструктура и DevOps' },
  { id: 'webdev', title: '🌐 Веб-разработка и API' },
  { id: 'dbase', title: '🗄 Базы данных' },
  { id: 'tooling', title: '🧰 Инструменты разработчика' },
  { id: 'writing', title: '✍️ Создание текстов' },
  { id: 'media', title: '🎬 Мультимодальный контент' },
  { id: 'life', title: 'Быт и развлечения' },
  { id: 'data', title: 'Data & Analytics' },
  { id: 'automation', title: 'Automation' },
  { id: 'safety', title: 'Safety & Security' },
  { id: 'context', title: '\uD83E\uDDE0 Контекст и языки' },
  { id: 'emotion', title: '\uD83D\uDE0A Эмоциональный интеллект' },
  { id: 'style', title: '\uD83C\uDFA8 Стиль и тон' },
  { id: 'adult', title: '\uD83D\uDD1E 18+' },
];

function S(id, cat, title, desc, re, opts) {
  return Object.assign({ id, cat, title, desc, re: re || null }, opts || {});
}

export { CATS, S };
