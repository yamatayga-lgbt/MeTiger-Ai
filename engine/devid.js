/**
 * ID устройства (0.176) — вместо аккаунтов.
 *
 * Владелец: «Вместо профилей, будет ID:Аккаунтов. Устройство будет определяться по
 * телефону (модель телефона). У моего айди будет доступ Разработчика, а у других —
 * обычный. Ошибки они отправляют разрабу». И дальше уточнил: ID человек придумывает
 * себе сам при первом заходе, без специальных знаков — только буквы, максимум 15.
 *
 * Здесь — только правила, без хранилища и без интерфейса: и браузер, и сервер обязаны
 * судить одинаково, иначе «в профиле написано одно, а на сервере другое».
 *   • 4–15 знаков, только латинские буквы: ни цифр, ни пробелов, ни # и @ (решётка —
 *     это украшение при показе «#Dev», человеку её вводить не нужно);
 *   • менять ID можно раз в неделю — срок считает СЕРВЕР по своей отметке времени,
 *     потому что часы устройства человек волен переставить;
 *   • #Dev — не для всех: этот ID закрепляется за владельцем, остальным он закрыт.
 */
export const ID_MIN = 4;
export const ID_MAX = 15;

/** Раз в неделю — просьба владельца. Считаем в сутках, а не «на глаз». */
export const RENAME_DAYS = 7;
export const RENAME_MS = RENAME_DAYS * 24 * 60 * 60 * 1000;

/** ID владельца: он один такой, и он закреплён. */
export const DEV_ID = 'Dev';

/** Служебные имена: их нельзя занять обычному человеку, иначе «#admin» станет маской. */
const RESERVED = ['dev', 'admin', 'administrator', 'owner', 'metiger', 'mt', 'support', 'moderator', 'system', 'root', 'help'];

/** «#Dev» → «Dev»: решётку человек не вводит, но если вставил — не ошибка. */
export const normalizeId = (v) => String(v == null ? '' : v).trim().replace(/^#+/, '').trim();

/** Почему ID не годится — словами для человека. Пустая строка: годится. */
export function idProblem(raw, { owner = false } = {}) {
  const id = normalizeId(raw);
  if (!id) return 'ID не может быть пустым';
  if (!/^[A-Za-z]+$/.test(id)) return 'только латинские буквы — без цифр, пробелов и знаков';
  /* Владельцу #Dev разрешён особо: он короче четырёх букв, но это его ID. */
  if (owner && id.toLowerCase() === DEV_ID.toLowerCase()) return '';
  /* Служебные имена проверяем раньше длины: человеку, набравшему «Dev», полезнее
     услышать «занято служебно», чем «нужно не меньше четырёх букв». */
  if (!owner && RESERVED.includes(id.toLowerCase())) return 'этот ID занят служебно — придумайте другой';
  if (id.length < ID_MIN) return `коротко: нужно не меньше ${ID_MIN} букв`;
  if (id.length > ID_MAX) return `длинно: не больше ${ID_MAX} букв`;
  return '';
}

/** Ключ-указатель «какой ID за каким устройством» — сравнение без учёта регистра. */
export const idIndexKey = (id) => 'ididx:' + normalizeId(id).toLowerCase();

/** Ключ устройства: тот же mt-uid, что был у памяти, только без мусора. */
export const deviceKeyOf = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32);

/** Сколько ждать до следующей смены, в миллисекундах (0 — можно менять сейчас). */
export function renameLeft(rec, now = Date.now()) {
  if (!rec || !rec.id) return 0;
  const next = Number(rec.idChangedAt || 0) + RENAME_MS;
  return Math.max(0, next - now);
}

/** Можно ли менять ID прямо сейчас. */
export const canRename = (rec, now = Date.now()) => renameLeft(rec, now) === 0;

/** «через 3 дня» / «через 5 часов» — чтобы человек понимал срок, а не гадал. */
export function renameWaitText(ms) {
  const left = Math.max(0, Number(ms) || 0);
  if (!left) return '';
  const days = Math.floor(left / (24 * 60 * 60 * 1000));
  if (days >= 1) return days === 1 ? 'через сутки' : `через ${days} ${days < 5 ? 'дня' : 'дней'}`;
  const hours = Math.max(1, Math.floor(left / (60 * 60 * 1000)));
  return `через ${hours} ч.`;
}

/**
 * Модель телефона по строке браузера — запасной путь, когда клиент ничего не прислал.
 * Разбираем ровно то, что браузеры туда кладут: «…; SM-A546B Build/…» — модель стоит
 * последней перед Build. Урезанные строки Android отдают просто «K» — это не модель,
 * и честнее показать пусто, чем букву «K» в админ-панели.
 */
export function modelFromUa(ua) {
  const s = String(ua || '');
  const android = /Android[^;]*;\s*([^;)]+?)(?:\s+Build|\))/.exec(s);
  let m = android ? android[1].trim() : '';
  if (!m || m === 'K') {
    /* Урезанные строки Android отдают «K» — это не модель, и честнее показать
       пусто (а в админ-панели — «модель неизвестна»), чем букву «K». */
    m = '';
    if (/iPhone/.test(s)) m = 'iPhone';
    else if (/iPad/.test(s)) m = 'iPad';
    else if (/Windows/.test(s)) m = 'Windows';
    else if (/Macintosh/.test(s)) m = 'Mac';
  }
  return m.replace(/\s+/g, ' ').slice(0, 40);
}

/** Ключ записи устройства в хранилище. */
export const deviceRecordKey = (key) => 'dev:' + deviceKeyOf(key);
