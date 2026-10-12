/**
 * Обращения об ошибках (0.173) — чистая часть: правила, ключи и замок владельца.
 *
 * Зачем отдельный файл, а не всё в functions/api/report.js: правила («сколько
 * знаков», «сколько фото», «чей это замок») должны проверяться тестами без сети
 * и без Cloudflare, а вход /api/report — остаться тонким. Тот же приём, что у
 * engine/limits.js и engine/profile.js.
 *
 * Как устроено хранилище (KV, связка MEMORY):
 *   · одна заявка — одно значение `rep:<время>:<хвост>`; время в ключе выровнено
 *     нулями до 13 знаков, поэтому `list` отдаёт ключи ровно в порядке времени;
 *   · в значении лежит текст, анонимный uid устройства, версия приложения и
 *     вердикт владельца — но НЕ фото;
 *   · фото живут отдельными ключами `rph:<хвост>:<номер>`. Так список владельцу
 *     читается без единого тяжёлого значения: в нём счётчик фото, а сами картинки
 *     приезжают только при открытии одной заявки;
 *   · список собирается из `list({ prefix: 'rep:' })` — без отдельного индекса,
 *     который мог бы разъехаться с содержимым.
 */
import { sanitizeUserId } from './profile.js';

export const REPORT_LIMITS = {
  /** Сколько знаков принимаем в описании. Как у окна ChatGPT — 2000. */
  MAX_CHARS: 2000,
  /** Сколько фото можно приложить (просьба владельца: «можно и до 4 фото»). */
  MAX_PHOTOS: 4,
  /** Потолок одного фото в знаках dataURL (~1,5 МБ). Клиент ужимает до этого сам. */
  MAX_PHOTO_CHARS: 1_500_000,
  /** Сколько обращений показываем владельцу одним списком (свежие сверху). */
  LIST_MAX: 60,
  /** Потолок частоты отправки — как у голоса: свой, чтобы не выбивало чужие лимиты. */
  RATE_DEFAULT: 5,
};

/**
 * Замок владельца: SHA-256 кода, а не сам код.
 *
 * Код владелец вводит один раз, на своём устройстве (вход — «Информация»,
 * пять тапов по версии, как «режим разработчика»). Дальше устройство держит код
 * у себя, а сервер сверяет только отпечаток: в репозитории отпечаток бесполезен,
 * и в коде его видеть безопасно. Сменить код = поменять отпечаток и выложить.
 */
export const OWNER_CODE_HASH = 'c77fb58e7c143fb0e2117fb151e86ff80dc607f1e697cd8cdef2df0f5c919968';

/** Отпечаток кода: пробелы и дефисы не важны, регистр не важен. */
export async function ownerHash(code) {
  const norm = String(code == null ? '' : code).replace(/[\s-]+/g, '').toUpperCase();
  if (!norm) return '';
  const bytes = new TextEncoder().encode('mt-owner:' + norm);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Подошёл ли код. Второй отпечаток (env) — для проверок без выкладки. */
export async function isOwnerCode(code, altHash) {
  const got = await ownerHash(code);
  if (!got) return false;
  const want = String(altHash || OWNER_CODE_HASH).trim().toLowerCase();
  if (got.length !== want.length) return false;
  /* Сравнение посимвольно, без раннего выхода: так ответ не выдаёт, сколько
     знаков отпечатка уже совпало. */
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

/** Текст описания: убираем управляющие знаки и хвосты, режем по потолку. */
export function cleanReportText(v) {
  const s = String(v == null ? '' : v)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim();
  return s.slice(0, REPORT_LIMITS.MAX_CHARS);
}

/**
 * Фото: берём только картинки в виде dataURL, не больше четырёх и не больше
 * потолка каждая. Возвращаем { photos, error } — ошибку показываем человеку,
 * а не молчим: «фото не приложилось» без причины хуже отказа.
 */
export function cleanReportPhotos(list) {
  const all = Array.isArray(list) ? list : [];
  const photos = [];
  for (const raw of all) {
    const s = String(raw == null ? '' : raw);
    if (!/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) {
      return { photos: [], error: 'фото не распознано — приложите картинку ещё раз' };
    }
    if (s.length > REPORT_LIMITS.MAX_PHOTO_CHARS) {
      return { photos: [], error: 'фото слишком большое — приложите другое или сделайте снимок заново' };
    }
    photos.push(s);
    if (photos.length > REPORT_LIMITS.MAX_PHOTOS) {
      return { photos: [], error: `фото не больше ${REPORT_LIMITS.MAX_PHOTOS} — лишние не берём` };
    }
  }
  return { photos, error: '' };
}

/** Ключ заявки: время нулями + хвост, чтобы list шёл по порядку времени. */
export function reportKey(now, id) {
  const ms = Math.max(0, Math.floor(Number(now) || 0));
  return 'rep:' + String(ms).padStart(13, '0') + ':' + String(id || 'x').slice(0, 10);
}

/** Ключ фото: заявка знает свой хвост, номер известен из счётчика. */
export function photoKey(id, i) {
  return 'rph:' + String(id || 'x').slice(0, 10) + ':' + Math.max(0, Math.floor(Number(i) || 0));
}

/** Короткий опознавательный хвост заявки (без uid и без данных устройства). */
export function newReportId(rand) {
  const bytes = new Uint8Array(5);
  if (typeof rand === 'function') {
    for (let i = 0; i < bytes.length; i++) bytes[i] = rand() & 0xff;
  } else {
    crypto.getRandomValues(bytes);
  }
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Заявка к хранению. Человек тут — только анонимный uid устройства: ни переписки,
 * ни имени, ни почты; владельцу этого хватает, чтобы понимать, одно устройство
 * пишет или разные.
 */
export function makeReport({ now, id, uid, ver, text, photos, did, model }) {
  const pics = Array.isArray(photos) ? photos.slice(0, REPORT_LIMITS.MAX_PHOTOS) : [];
  return {
    rec: {
      id: String(id || ''),
      at: Math.floor(Number(now) || Date.now()),
      uid: sanitizeUserId(uid),
      /* 0.176: в обращении видно, кто это и с какого телефона — владелец просил
         «в обращениях тоже» данные устройства. ID показываем как есть (человек сам
         его выбрал), буквы и регистр не портим. */
      did: String(did || '').replace(/^#+/, '').slice(0, 15),
      model: String(model || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      ver: String(ver || '').replace(/[^\w.\-+]/g, '').slice(0, 24),
      text: cleanReportText(text),
      photoCount: pics.length,
      status: 'new',
      verdictAt: 0,
    },
    photos: pics,
  };
}

/** Вердикт владельца: «Рассмотрено» или «Отказано» — третьего не принимаем. */
export function cleanVerdict(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'done' || s === 'declined' ? s : '';
}

/**
 * Что владелец делает с заявкой: поставить вердикт или УБРАТЬ её.
 *
 * Уборка понадобилась после живой проверки (12 окт): в списке владельца остались
 * пробные обращения, отправленные во время разработки, и убрать их было нечем —
 * вердикт меняет статус, но запись остаётся. Дверь принимает это отдельным
 * действием, чтобы «убрать» нельзя было спутать с вердиктом.
 */
export function cleanAction(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'done' || s === 'declined' || s === 'delete' ? s : '';
}

/** Заявка без фото и с коротким текстом — то, что уходит в список владельцу. */
export function reportSummary(rec) {
  const r = rec && typeof rec === 'object' ? rec : {};
  return {
    id: String(r.id || ''),
    at: Math.floor(Number(r.at) || 0),
    uid: String(r.uid || '').slice(0, 12),
    did: String(r.did || '').slice(0, 15),
    model: String(r.model || '').slice(0, 40),
    ver: String(r.ver || ''),
    text: cleanReportText(r.text),
    photos: Math.max(0, Math.floor(Number(r.photoCount) || 0)),
    status: cleanVerdict(r.status) || 'new',
    verdictAt: Math.floor(Number(r.verdictAt) || 0),
  };
}
