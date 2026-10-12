/**
 * Письма (0.174) — то, через что человек получает новый пароль.
 *
 * Зачем отдельным файлом: писем пока два вида (новый пароль и приветствие при
 * регистрации), но правило одно — письмо должно уходить через тот же сервис,
 * ключ к которому есть, и честно отказывать, если ключа нет. Молчаливая «отправка
 * в никуда» хуже отказа: человек ждал бы письмо, которого не будет.
 *
 * Сервис — Brevo (владелец выбрал: 300 писем в день бесплатно). Ключи:
 *   BREVO_API_KEY — ключ из панели Brevo;
 *   BREVO_FROM    — проверенный адрес отправителя (в Brevo он подтверждается один раз);
 *   BREVO_FROM_NAME — имя отправителя, по умолчанию «MeTiger Ai».
 */

export const MAIL_LIMITS = {
  /** Потолок длины письма — предохранитель, а не рабочий режим. */
  MAX_CHARS: 20_000,
  /** Сколько писем в минуту разрешаем на один адрес (защита от «нажму 10 раз»). */
  PER_MINUTE: 3,
};

export function mailConfigured(env) {
  const e = env || {};
  return !!(String(e.BREVO_API_KEY || '').trim() && String(e.BREVO_FROM || '').trim());
}

/**
 * Отправка письма. Возвращает { ok, why } — причину отказа показываем человеку
 * словами: «почта ещё не подключена» понятнее, чем пустое место.
 */
export async function sendMail(env, { to, subject, text }) {
  if (!mailConfigured(env)) return { ok: false, why: 'почта ещё не подключена' };
  const body = {
    sender: {
      email: String(env.BREVO_FROM).trim(),
      name: String(env.BREVO_FROM_NAME || 'MeTiger Ai').trim(),
    },
    to: [{ email: String(to || '').trim() }],
    subject: String(subject || 'MeTiger Ai').slice(0, 180),
    textContent: String(text || '').slice(0, MAIL_LIMITS.MAX_CHARS),
  };
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': String(env.BREVO_API_KEY).trim(), 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.status >= 400) {
      /* Тело ответа читаем: Brevo пишет причину словами («sender not verified» —
       *  адрес отправителя не подтверждён), и это ровно то, что нужно владельцу. */
      const detail = await r.text().catch(() => '');
      return { ok: false, why: 'почтовый сервис отказал: ' + detail.slice(0, 160).replace(/\s+/g, ' ') };
    }
    return { ok: true, why: '' };
  } catch (e) {
    return { ok: false, why: 'письмо не ушло: ' + String((e && e.message) || 'сеть') };
  }
}

/** Письмо с новым паролем. Ровно то, о чём просил владелец: «на почту поступает пароль». */
export function newPasswordLetter({ email, password, appName = 'MeTiger Ai' }) {
  const subject = appName + ': новый пароль';
  const text = [
    'Здравствуйте!',
    '',
    'Вы запросили восстановление пароля в ' + appName + '.',
    'Новый пароль: ' + password,
    '',
    'Войдите с ним и, если хотите, смените пароль на свой в профиле.',
    'Если это были не вы — просто войдите новым паролем и смените его: старый больше не действует.',
    '',
    'Адрес, на который пришло письмо: ' + email,
  ].join('\n');
  return { subject, text };
}

/**
 * Простой ограничитель «не чаще N писем в минуту на адрес».
 * Карта живёт в модуле — в Pages воркер переиспользуется между запросами.
 */
const recent = new Map();

export function mailTooOften(to, now) {
  const key = String(to || '').toLowerCase();
  const t = Number(now || Date.now());
  const list = (recent.get(key) || []).filter((x) => t - x < 60_000);
  if (list.length >= MAIL_LIMITS.PER_MINUTE) return true;
  list.push(t);
  recent.set(key, list);
  /* Раз в сотню записей подчищаем совсем старое — иначе карта росла бы вечно. */
  if (recent.size > 200) {
    for (const [k, v] of recent) {
      if (!v.some((x) => t - x < 60_000)) recent.delete(k);
    }
  }
  return false;
}
