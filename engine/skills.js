/**
 * Навыки агента — перенесённый механизм донора (yama-ai/skills.js).
 *
 * Навык — это не вызов функции, а строчка в системный промпт: «раз человек спрашивает
 * про стихи, веди себя как поэт и вот по каким правилам». Включается автоматически по
 * смыслу сообщения, несколько сразу, каждый может потребовать инструмент.
 *
 * Что изменено против донора и почему:
 *   • имена инструментов наши (donor: web/page/wiki/rand → наши id из engine/tools.js);
 *   • навыки, которым нужно то, чего в этом клиенте нет (загрузка файлов, генерация
 *     картинок, n8n, обход монетизированных ссылок, управление эффектом печати),
 *     выключены и помечены причиной. Донор на такое вешал в промпт «инструмент недоступен,
 *     скажи прямо» — здесь приём жёстче: целые категории, где выполнять нечем, не тратят
 *     бюджет промпта, а в /api/skills их видно с объяснением;
 *   • часть текстов переопределена (OVERRIDES), где донор описывал свои настройки и свои
 *     разделы промпта, которых у нас нет — иначе модель ссылалась бы на несуществующее.
 *
 * Бюджет держим доноровский: не больше SKILL_MAX навыков и SKILL_MAX_CHARS знаков,
 * иначе промпт распухает и модель начинает слушаться всех сразу, то есть никого.
 */

import { CATS } from './skills/helpers.js';
import { TOOL_IDS } from './tools.js';

import s_reasoning from './skills/reasoning.js';
import s_comm from './skills/comm.js';
import s_research from './skills/research.js';
import s_intel from './skills/intel.js';
import s_knowledge from './skills/knowledge.js';
import s_memory from './skills/memory.js';
import s_coding from './skills/coding.js';
import s_web from './skills/web.js';
import s_files from './skills/files.js';
import s_vision from './skills/vision.js';
import s_editing from './skills/editing.js';
import s_diagnostics from './skills/diagnostics.js';
import s_control from './skills/control.js';
import s_search from './skills/search.js';
import s_text from './skills/text.js';
import s_code from './skills/code.js';
import s_plan from './skills/plan.js';
import s_life from './skills/life.js';
import s_problem from './skills/problem.js';
import s_decision from './skills/decision.js';
import s_reading from './skills/reading.js';
import s_stats from './skills/stats.js';
import s_programming from './skills/programming.js';
import s_architecture from './skills/architecture.js';
import s_debugging from './skills/debugging.js';
import s_testing from './skills/testing.js';
import s_devops from './skills/devops.js';
import s_webapi from './skills/webapi.js';
import s_database from './skills/database.js';
import s_tooling from './skills/tooling.js';
import s_writing from './skills/writing.js';
import s_media from './skills/media.js';
import s_ux from './skills/ux.js';
import s_visual from './skills/visual.js';
import s_docs2 from './skills/docs2.js';
import s_i18n from './skills/i18n.js';
import s_edu from './skills/edu.js';
import s_toolcraft from './skills/toolcraft.js';
import s_data from './skills/data.js';
import s_automation from './skills/automation.js';
import s_safety from './skills/safety.js';
import s_context from './skills/context.js';
import s_emotion from './skills/emotion.js';
import s_style from './skills/style.js';
import s_neural from './skills/neural.js';
import s_bypass from './skills/bypass.js';
import s_adult from './skills/adult.js';

const RAW = [
  ...s_reasoning, ...s_comm, ...s_research, ...s_intel, ...s_knowledge, ...s_memory,
  ...s_coding, ...s_web, ...s_files, ...s_vision, ...s_editing, ...s_diagnostics,
  ...s_control, ...s_search, ...s_text, ...s_code, ...s_plan, ...s_life, ...s_data,
  ...s_automation, ...s_safety, ...s_context, ...s_emotion, ...s_style, ...s_neural,
  ...s_bypass, ...s_adult,
  /* наше дополнение (не донорское): цикл решения проблем — см. engine/skills/problem.js */
  ...s_problem, ...s_decision,
  ...s_reading, ...s_stats,
  /* наше дополнение: группы 13–17 — программирование, архитектура, отладка, тесты, DevOps */
  ...s_programming, ...s_architecture, ...s_debugging, ...s_testing, ...s_devops,
  ...s_webapi, ...s_database, ...s_tooling, ...s_writing, ...s_media, ...s_ux, ...s_visual, ...s_docs2, ...s_i18n, ...s_edu, ...s_toolcraft,
];

/* ============================== соответствие имён ============================== */

/** Имена инструментов у донора ≠ наши id; один и тот же инструмент — одно имя. */
export const TOOL_ALIAS = {
  web: 'web-search',
  page: 'url',
  wiki: 'wikipedia',
  rand: 'random',
  imageSearch: 'image-search',
};

/** Чему в этом клиенте нечем выполняться — по id навыка (у категорий ниже свой признак). */
export const OFF_IDS = {
  'auto-n8n': 'внешнего воркфлоу-сервера (n8n) не подключено',
  'neural-typing': 'скорость и эффект печати здесь не настраиваются из диалога',
  'neural-speed': 'скорость и эффект печати здесь не настраиваются из диалога',
  'neural-toggle': 'скорость и эффект печати здесь не настраиваются из диалога',
  'w-nav': 'кликать по сайтам нечем: инструмент читает страницу один раз',
  'w-form': 'заполнять чужие формы нечем: у нас только чтение страницы',
  'w-monitor': 'слежением за изменениями страницы никто не занимается',
  'emo-voice': 'голос в этот канал не приходит — только текст и картинки',
  'emo-multimodal': 'голос в этот канал не приходит — только текст и картинки',
};

/** Категории, которым нечего выполнять целиком.
   `files` здесь больше не стоит: с 0.021 присланный в Telegram документ разбирается
   собственным читателем (engine/docparse.js: DOCX/XLSX/PPTX/PDF/CSV/TXT), а на исход
   файл упаковывает `filegen` — то есть 19 навыков категории имеют чем выполняться.
   Остались только честные частные причины в OFF_IDS (то, чего механизм не делает). */
export const OFF_CATS = {};

/**
 * Категории, которые оживают сами. `tool` — инструмент, которым навык выполняется;
 * пока он не ответил хоть раз, навык остаётся выключенным и причина видна человеку.
 * Так 11 навыков правки картинок не врут «я готово», когда генератор молчит, и
 * включаются без правки кода, как только канал заработает.
 */
export const LIVE_CATS = {
  editing: { tool: 'imggen', reason: 'ни один источник картинок ещё не ответил' },
};

/* ====================== тексты, которые переписаны под нас ====================== */

/** Навык остаётся, но формулировка донора ссылалась на его механизм, а не на наш. */
export const OVERRIDES = {
  /* Донорский dev-write отправлял модель «запусти run_js с проверками» — такого инструмента у нас
     нет, и текст противоречил рамке категории. Формулировка честно про глаза и про крайние
     случаи; когда прогон появится (перенос tdd из Yama), её надо вернуть к исполнению. */
  'dev-write': 'пиши код целиком и рабочий: импорты, основная часть, сложность одной строкой. Прогона у тебя нет, поэтому перед финалом прогони глазами по краям: пусто, 0, один элемент, дубли, не тот тип — и назови, что проверил. Не выдумывай API: в сомнении скажи прямо, что имя надо сверить с документацией. Язык из вопроса; если не назван — выбери и объясни почему',
  /* Донорский «работа с API» обещал пагинацию, лимиты и ретраи — это теперь территория wd-*;
     ему остаётся сценарный угол: где ключи, как часто, что делать при отказе. */
  'auto-api': 'встроить api в сценарий: где лежит ключ (переменная окружения, не текст сценария), как часто запускать, что делать при отказе (не слать алерт на каждую 500), как понять, что данные протухли; сам запрос, пагинацию, лимиты и ретраи описывает навык веб-разработки',
  /* Читатель файлов отдаёт текст, а не вёрстку: страницы, номера строк и «исходник
     поправлен на месте» — то, чего у нас нет ни в одном варианте. */
  'f-pdf-read': 'читай PDF по извлечённому тексту, а не по имени файла: отвечай на вопрос, цитируй дословно и называй раздел или заголовок, откуда фраза. Номера страниц при разборе не видно — есть только общее число страниц, «стр. 12» не выдумывай. Текст не извлёкся (скан без текстового слоя) — скажи прямо и предложи прислать страницу картинкой: зрение читает. Чего в файле нет, того в ответе нет',
  'f-txt': 'читай текстовый файл как инженер: что за источник, где нужное место или ошибка, что ей предшестовало. Цитируй строку целиком и указывай, около чего она (после какого заголовка), порядковый номер называй только если точно досчитался. Объясняй причину и давай конкретное исправление, а не «попробуйте перезапустить». Для конфигов и разметки проверяй синтаксис: незакрытые кавычки, отступы, дубли ключей',
  'f-find': 'ищи точно и показывай, где нашёл: раздел, заголовок, имя листа или столбца — тем и указывает место собственный читатель файлов, страницу он не размечает. Нашёл — приведи фрагмент дословно, а не своими словами. Не нашёл — скажи, что искал и в каком объёме текста, и назови похожее по смыслу. Искать по всему блоку файла, а не по первым абзацам: нужное часто в конце',
  'f-structure': 'проверь файл как проверку, а не как чтение: прочитался ли он вообще (движок сам говорит, сколько знаков, абзацев, листов или слайдов и не обрезано ли по объёму), целы ли разделы и нумерация, на месте ли обязательные реквизиты (даты, подписи, суммы, названия сторон), нет ли битой разметки и оборванных таблиц. Отдай список найденного по важности: что ломает смысл, что только оформление. Чего проверить нельзя — назови прямо, а не промолчи',
  'f-edit': 'правь точно и показывай правку: что было → что стало → где именно. Меняй только то, о чём просили, остальное оставь дословно, включая форматирование и порядок строк. Если правка ломает соседнее (нумерация, суммы, ссылки на пункты), назови это и предложи, как поправить вместе. Исходник на месте не перезаписывается: правка одна — покажи точный фрагмент «было → стало», нужен результат целиком — собери новый файл инструментом filegen (весь документ, не фрагмент)',
  'd-capabilities': 'опиши возможности по факту: инструменты перечислены в блоке «Инструменты этого ответа», ниже — активные навыки, приложены ли картинки. Перечисляй конкретно и не обещай то, чего в блоке нет: кликов по сайтам и расписания у нас нет, в веб-чате нет и загрузок (файл принимает только Telegram); присланный документ читается сам — docx, xlsx, pptx, pdf, csv, txt, а файл на исход отдаёт инструмент «Файл»; генерация картинок есть ровно тогда, когда в инструментах этого ответа числятся «Картинки» — нет их там, значит канал молчит и надо сказать это прямо.',
  'd-tools': 'перечисли инструменты из блока «Инструменты этого ответа» — только те, что там написаны, с назначением и примером. Отвечать «инструментов нет», пока блок не пуст, — врать; выдумывать инструменты тоже нельзя. Что инструмент уже сработал — видно по блоку данных над твоим ответом.',
  'd-tool-health': 'о здоровье инструментов суди по факту этого ответа: если данные инструмента пришли — он работает, если блок пуст или в нём ошибка — назови инструмент, что именно не пришло и что человек может сделать сам. Пробных вызовов ты не делаешь и не ври, что сделал.',
  'tool-use': 'если для ответа есть инструмент — его данные уже подложены в твоё сообщение блоками [Инструмент: …]; отвечай по ним, а не по памяти. Блока нет — значит инструмента для этого запроса не было: скажи прямо, а не придумывай результат его работы.',
  'fresh': 'новости, цены, версии, курсы и события меняются после твоего обучения: если вопрос из этого ряда, опирайся на блок [Инструмент: Веб-поиск] или [Инструмент: Новости] — они приходят сами на такие темы. Ссылайся нумерацией как в выдаче ([1], [2]); своих цифр из памяти не подставляй.',
  'v-search': 'человек спрашивает, откуда картинка: опирайся на блок [Инструмент: Поиск картинок] (наш image-search) и, если нужно, на [Инструмент: Веб-поиск]. Опиши, что видно, и скажи прямо, если совпадений нет: угадать источник по описанию — не значит найти.',
  'd-limits': 'называй ограничения честно и только свои: браузера с кликами нет, формы за человека не заполняю, файлы в чат не принимаю и не отправляю (кроме тех, что сам сгенерировал: txt, md, csv, docx, xlsx, html), фонового наблюдения и расписания нет, картинки не рисую. Всё, что есть: текст, две картинки на вход, поиск, страница по ссылке, вики, погода, курсы, новости, поиск картинок, точная арифметика, файлы-документы на выход и память разговора.',
};

/** Короткие рамки: навык остаётся полезным, но не обещает лишнего. */
export const FRAMES = {
  coding: ' Код ты не запускаешь: не утверждай, что проверил его прогоном, — называй, что именно стоит проверить.',
  auto_schedule: ' Расписанием и фоном ты не управляешь: план, скрипт и инструкцию — дай, «поставил на 9:00» — нет.',
  memory: ' Память разговора ведётся сама (реплики и факты пишутся в KV): подтверждай, что запомнили, но не выдумывай отдельный инструмент записи.',
  data_visual: ' Картинки ты не рисуешь: график — это код или таблица, а не изображение.',
  devops: ' Инфраструктурой и выпуском ты не управляешь: конфиг, pipeline, команды и план — напиши; «задеплоил» и «откатил» — нет.',
  webdev: ' Живых запросов к API ты не отправляешь: наружу ходит только чтение страницы; «проверил на сервере» и «получил 200» — не выдумывай.',
  dbase: ' Доступа к базе у тебя нет: SQL, план миграции и разбор — напиши; «выполнил запрос» и «данные на проде проверил» — нет.',
  tooling: ' Команды ты не выполняешь: точные строки, флаги и порядок действий — напиши; «прогнал линтер» и «установилось» — нет.',
  media: ' Видео и аудио ты не смотришь: ни ffprobe, ни плеера нет; таймкоды и «проверил на 3:12» не выдумывай, приложенную картинку видит модель, и только её.',
  ux: ' Интерфейс мы не видим: ни Figma, ни браузера, ни кликов. Основание — описание, код или присланный скриншот.',
  visual: ' Макет не рендерим и линейкой не меряем: только спецификация — числа, имена, hex из присланного.',
  techdoc: ' Док репозитория не читаем и на месте не правим: только присланный текст, непроверенное так и называем.',
  i18n: ' Языка не знаем: только присланный текст и названные правила локали.',
  learning: ' ' + ('Человека не видим: судим по присланным ответам, уровень не приписываем.'),
  /* Вызов исполняет движок, навык — нет: без рамки он начал бы докладывать о
     «проверенном повтором» и «отправленном». */
  toolcraft: ' ' + ('Вызов исполняет движок: мы готовим строки и читаем его блоки, сами не запускаем.'),
};

/** У навыков со слишком широких триггеров — второе условие: без него навык лезет в спокойный разговор.
    Измерено на корпусе: ad-lang срабатывал на «переведи на английский» и тащил в промпт
    инструкции про флирт — этого в системном блоке быть не должно. */
export const GATE = {
  'ad-lang': /эрот|секс|постел|флирт|интим|обним|18\+|без цензур|ню|страст|желан/i,
  'ad-persona': /эрот|секс|флирт|интим|ролев|сценарий|парн[ёе]рш|желан|страст/i,
  'ad-fantasy': /эрот|секс|флирт|интим|постел|желан|страст|ролев/i,
};

/** Навыки, которых касается рамка по категории/списку id. */
const FRAME_BY_ID = {};
for (const s of RAW) {
  if (s.cat === 'coding') FRAME_BY_ID[s.id] = FRAMES.coding;
  /* Отладка и тесты живут в своих категориях, но упираются в тот же потолок: прогона кода
     нет, поэтому рамка «не утверждай, что проверил» нужна им сильнее, чем кому бы то ни было. */
  else if (s.cat === 'debug' || s.cat === 'testing') FRAME_BY_ID[s.id] = FRAMES.coding;
  else if (s.cat === 'devops') FRAME_BY_ID[s.id] = FRAMES.devops;
  /* Веб/API, базы и инструменты упираются в отсутствие рук: ни HTTP-вызова, ни подключения к
     базе, ни запущенного линтера у нас нет — рамка обязана быть на каждом из этих текстов. */
  else if (s.cat === 'webdev') FRAME_BY_ID[s.id] = FRAMES.webdev;
  else if (s.cat === 'dbase') FRAME_BY_ID[s.id] = FRAMES.dbase;
  else if (s.cat === 'tooling') FRAME_BY_ID[s.id] = FRAMES.tooling;
  else if (s.cat === 'media') FRAME_BY_ID[s.id] = FRAMES.media;
  else if (s.cat === 'ux') FRAME_BY_ID[s.id] = FRAMES.ux;
  else if (s.cat === 'visual') FRAME_BY_ID[s.id] = FRAMES.visual;
  else if (s.cat === 'techdoc') FRAME_BY_ID[s.id] = FRAMES.techdoc;
  /* Локализация без словаря и без носителя: рамка на каждом навыке группы 26, иначе
     «так говорят носители» уезжает в ответ как факт. */
  else if (s.cat === 'i18n') FRAME_BY_ID[s.id] = FRAMES.i18n;
  /* Ученика перед глазами нет: без его присланных ответов навык не имеет права ни на
     диагноз, ни на «уровень». Рамка на всех пятерых навыках группы 27. */
  else if (s.cat === 'learning') FRAME_BY_ID[s.id] = FRAMES.learning;
  /* Инструменты группы 28 описывают подготовку вызова: рамка нужна каждому, иначе
     навык присвоит себе исполнение. */
  else if (s.cat === 'toolcraft') FRAME_BY_ID[s.id] = FRAMES.toolcraft;
  else if (s.cat === 'memory') FRAME_BY_ID[s.id] = FRAMES.memory;
  else if (s.cat === 'data' && /chart|report/.test(s.id)) FRAME_BY_ID[s.id] = FRAMES.data_visual;
}
for (const id of ['auto-schedule', 'auto-monitor', 'auto-event', 'auto-report', 'auto-update', 'auto-transfer', 'auto-check']) FRAME_BY_ID[id] = FRAMES.auto_schedule;

/* ============================== сборка реестра ============================== */

const HAVE = new Set(TOOL_IDS());
const alias = (t) => TOOL_ALIAS[t] || t;

/** Нормализованный навык: наши имена инструментов, причина отключения, готовый текст. */
function build(s) {
  const need = (s.tools || []).map(alias);
  const missing = need.filter((t) => !HAVE.has(t));
  let off = null;
  const live = LIVE_CATS[s.cat] || null;
  if (OFF_CATS[s.cat]) off = OFF_CATS[s.cat];
  else if (live) off = live.reason;
  else if (OFF_IDS[s.id]) off = OFF_IDS[s.id];
  else if (missing.length) off = 'нет инструмента ' + missing.join(', ');
  const text = OVERRIDES[s.id] || s.prompt || s.desc;
  return Object.assign({}, s, {
    need,
    off,
    live: live ? live.tool : '',
    text: String(text) + (FRAME_BY_ID[s.id] || ''),
  });
}

export const SKILLS = RAW.map(build);
export const ON_SKILLS = SKILLS.filter((s) => !s.off);
export const OFF_SKILLS = SKILLS.filter((s) => s.off);

const byId = new Map(SKILLS.map((s) => [s.id, s]));
export const skillById = (id) => byId.get(id) || null;

/* ============================== авто-подбор ============================== */

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

/**
 * Навыки для этого сообщения. ctx: { images, env }.
 * always — первые; дальше совпавшие по тексту, по приоритету, в пределах бюджета.
 * Инструмент, который человек мог выключить (env.TOOLS_OFF), навык не отменяет —
 * промпт получает предупреждение, чтобы модель не делала вид, что вызвала его.
 */
export function detect(message, ctx) {
  const o = ctx || {};
  const env = o.env || {};
  const off = String(env.TOOLS_OFF || '').split(',').map((x) => alias(x.trim())).filter(Boolean);
  const maxN = env.SKILLS === 'off' ? 0 : num(env.SKILL_MAX, 16);
  if (!maxN) return [];
  const maxChars = num(env.SKILL_MAX_CHARS, 3000);
  const t = String(message || '').toLowerCase();

  /* Живой инструмент поднимает свою категорию: imggen доказал, что отдаёт картинки,
     — значит навыкам правки есть чем выполняться. Доказательства нет — не поднимаем. */
  const usable = (o.imgToolReady && o.imgToolReady.imggen)
    ? SKILLS.filter((x) => !x.off || x.live === 'imggen')
    : ON_SKILLS;
  const always = usable.filter((s) => s.always);
  const hit = usable.filter((s) => !s.always && s.re && s.re.test(t) && (!GATE[s.id] || GATE[s.id].test(t)));

  /* Приложена картинка, а зрительный навык по тексту не совпал — модель иначе
     получила бы изображение без инструкции, как его разбирать. */
  if (o.images && o.images.length && !hit.some((s) => s.cat === 'vision')) {
    const base = usable.find((s) => s.id === 'v-analyze');
    if (base) hit.push(Object.assign({}, base, { priority: 99 }));
  }

  hit.sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
  const dropped = new Set();
  hit.forEach((s) => (s.supersedes || []).forEach((id) => dropped.add(id)));

  const lenOf = (s) => String(s.title || '').length + s.text.length;
  /* Потолок общий, а не «сверху к всегдашним» (как у донора): SKILL_MAX=2 должно значить
     «два навыка в промпте», иначе лимит держит только переменную часть и человек,
     ограничивающий размер запроса, получает больше, чем просил. */
  const slots = Math.max(0, maxN - always.length);
  const picked = [];
  let size = always.reduce((n, s) => n + lenOf(s), 0);
  for (const s of hit) {
    if (dropped.has(s.id)) continue;
    if (picked.length >= slots) break;
    if (picked.length && size + lenOf(s) > maxChars) continue;
    picked.push(s);
    size += lenOf(s);
  }
  const out = always.slice(0, maxN).concat(picked);
  return out.map((s) => ({
    id: s.id,
    cat: s.cat,
    title: s.title,
    text: s.text,
    tools: s.need.filter((x) => off.indexOf(x) < 0),
    offTools: s.need.filter((x) => off.indexOf(x) >= 0),
    always: !!s.always,
    priority: Number(s.priority) || 0,
  }));
}

/** Блок в системный промпт — формат донора, плюс строка доступных инструментов. */
export function blockOf(active, o) {
  if (!active || !active.length) return '';
  const toolsLine = o && o.toolTitles && o.toolTitles.length
    ? '\n\n【Инструменты этого ответа】' + o.toolTitles.join(', ')
    : '';
  return '【Активные навыки (включены автоматически — применяй их)】\n'
    + 'Инструменты устроены не как в агентской среде: вызывать их тебе нечем — данные уже подложены '
    + 'в сообщение человека блоками [Инструмент: …]. Нет блока — нет и данных, выдумывать их нельзя.\n'
    + active.map((s) => '- ' + s.title + ': ' + s.text
      + (s.offTools && s.offTools.length
        ? ' ⚠ ' + s.offTools.join(', ') + ' сейчас недоступен — скажи об этом прямо и предложи ручной путь, а не делай вид, что вызвал.'
        : '')).join('\n')
    + toolsLine;
}

/**
 * Какие инструменты позвать ради этих навыков.
 * Всегда включённые (у донора это «всегда свежий поиск») в список НЕ попадают: у нас
 * бесплатные лимиты и каждая сеть — плюс секунда к ответу, а их инструкции и так
 * в промпте. Принудительный вызов — только у навыка, который совпал по теме.
 */
export function toolsOf(active) {
  const out = new Set();
  for (const s of (active || [])) {
    if (s.always) continue;
    for (const t of s.tools || []) out.add(t);
  }
  return [...out];
}

/** Сводка для /api/skills и тестов: сколько чего и почему выключено. */
export function stats(ctx) {
  const ready = (ctx && ctx.imgToolReady && ctx.imgToolReady.imggen) || false;
  const offNow = (s) => !!s.off && !(ready && s.live === 'imggen');
  const groups = CATS.map((c) => {
    const list = SKILLS.filter((s) => s.cat === c.id);
    return {
      id: c.id,
      title: c.title,
      total: list.length,
      on: list.filter((s) => !offNow(s)).length,
      off: list.filter(offNow).length,
    };
  });
  const why = {};
  for (const s of SKILLS.filter(offNow)) { const k = s.off; why[k] = (why[k] || 0) + 1; }
  return {
    total: SKILLS.length,
    on: SKILLS.length - SKILLS.filter(offNow).length,
    off: SKILLS.filter(offNow).length,
    tools: [...HAVE].sort(),
    groups,
    reasons: Object.entries(why).map(([reason, n]) => reason + ' ×' + n),
    /* что может включиться само: инструмент жив — категория оживает */
    live: Object.entries(LIVE_CATS).map(([cat, v]) => ({ cat, tool: v.tool, ready })),
  };
}

export { CATS };
