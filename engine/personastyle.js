/**
 * Стиль общения из Персонализации (0.186) — настройки человека из приложения.
 *
 * Экран «Персонализация» (как в ChatGPT): базовый стиль и тон, дружелюбие,
 * энтузиазм, заголовки и списки, эмодзи, быстрые ответы, визуальные ответы.
 * Значения едут полем `persona` в /api/chat, здесь превращаются в короткий
 * блок системной подсказки. Всё по умолчанию — пустая строка: промпт остаётся
 * ровно прежним, лишних токенов нет.
 *
 * Правило честности то же, что у freedom и skills: настройка говорит КАК
 * отвечать, но не отменяет безопасность и не запрещает структуре ответа быть
 * полезной (циничный тон — не повод отказать или наврать).
 */

const STYLES = ['default', 'professional', 'friendly', 'candid', 'quirky', 'efficient', 'cynical'];
const LEVELS = ['less', 'default', 'more'];
const VISUALS = ['default', 'simple'];

const STYLE_LINE = {
  professional: 'Стиль и тон — профессиональный: тактичный и точный.',
  friendly: 'Стиль и тон — дружелюбный: тёплый и разговорчивый.',
  candid: 'Стиль и тон — откровенный: прямой и мотивирующий.',
  quirky: 'Стиль и тон — причудливый: весёлый и творческий.',
  efficient: 'Стиль и тон — эффективный: немногословный и чёткий, без воды.',
  cynical: 'Стиль и тон — циничный: критикующий и саркастичный, но корректный и честный; шутки над обстоятельствами, а не над человеком.',
};

const LEVEL_LINE = {
  friendliness: {
    more: 'Дружелюбие — выше обычного: более дружелюбный и располагающий тон.',
    less: 'Дружелюбие — ниже обычного: более профессиональный и основанный на фактах тон.',
  },
  enthusiasm: {
    more: 'Энтузиазм — выше обычного: больше энергии и вовлечённости.',
    less: 'Энтузиазм — ниже обычного: спокойнее и суше.',
  },
  headers: {
    more: 'Заголовки и списки — используй чаще, где они помогают структуре.',
    less: 'Заголовки и списки — по минимуму: предпочитай связный текст, если не просят иначе.',
  },
  emoji: {
    more: 'Эмодзи — используй больше, где это уместно.',
    less: 'Эмодзи — не используй без явной просьбы.',
  },
};

/** Что угодно → честные настройки: каждое поле по белому списку, мусор — умолчание. */
export function normalize(p) {
  const o = (p && typeof p === 'object' ? p : {});
  const one = (list, v) => (list.indexOf(v) >= 0 ? v : 'default');
  return {
    style: one(STYLES, o.style),
    friendliness: one(LEVELS, o.friendliness),
    enthusiasm: one(LEVELS, o.enthusiasm),
    headers: one(LEVELS, o.headers),
    emoji: one(LEVELS, o.emoji),
    quick: o.quick === true,
    visual: one(VISUALS, o.visual) === 'simple' ? 'simple' : 'default',
  };
}

export function isDefault(p) {
  const n = normalize(p);
  return n.style === 'default' && n.friendliness === 'default' && n.enthusiasm === 'default'
    && n.headers === 'default' && n.emoji === 'default' && !n.quick && n.visual === 'default';
}

/**
 * Кусок в system. Пустые настройки → '' (вызовов лишних токенов нет).
 * Идёт ПОСЛЕ рода агента и до профиля: это про тон, а не о данных человека.
 */
export function block(p) {
  const n = normalize(p);
  if (isDefault(n)) return '';
  const lines = [];
  if (n.style !== 'default') lines.push(STYLE_LINE[n.style]);
  for (const key of ['friendliness', 'enthusiasm', 'headers', 'emoji']) {
    if (n[key] !== 'default') lines.push(LEVEL_LINE[key][n[key]]);
  }
  if (n.quick) {
    lines.push('Быстрые ответы: сначала короткий прямой ответ (1–3 предложения); поиски, память и подробности — только если вопрос без них не решается.');
  }
  if (n.visual === 'simple') {
    lines.push('Визуальные ответы — простые: картинки и графики не создавай без явной просьбы.');
  }
  return '\n\n[Стиль общения — настройка человека из Персонализации; это важнее твоих привычек, но не важнее безопасности и честности]:\n'
    + lines.map((l) => '- ' + l).join('\n');
}
