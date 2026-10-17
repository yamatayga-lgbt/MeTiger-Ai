/**
 * Род агента и пол собеседника — две независимые оси (0.204).
 *
 * Род АГЕНТА: как агент говорит О СЕБЕ («я рад» / «я рада»). Настройка
 * человека («Настройки → Ассистент → Род агента», поле `gender`) или env
 * `AGENT_GENDER`; `auto` — подстройка под пол собеседника из профиля.
 *
 * Пол СОБЕСЕДНИКА: как к нему обращаться во втором лице («ты сказал» /
 * «ты сказала»). Берётся из его профиля (дверь шлёт `userGender`, плюс
 * разбираем строку «Пол: …» из текстового блока профиля для клиентов,
 * которые отдельного поля не знают).
 *
 * Оси независимы, и это прямо сказано модели: парень с агентом-парнем —
 * обычная пара, как и любая другая; комментировать сочетание не надо,
 * путать окончания о себе с окончаниями о собеседнике — нельзя.
 *
 * Что было сломано до 0.204: blockFor ждал пол собеседника объектом
 * `input.profile.gender`, а в проде профиль приезжает ТЕКСТОМ («· Пол:
 * Мужской») — подстройка под пол человека была мёртвым кодом, и в auto
 * агент рода из профиля никогда не получал.
 */

export const GENDERS = ['auto', 'male', 'female'];

/** Приводит что угодно к одному из трёх значений; всё непонятное — `auto`. */
export function normalize(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (v === 'male' || v === 'м' || v === 'муж' || v === 'мужской' || v === 'он' || v === 'm') return 'male';
  if (v === 'female' || v === 'ж' || v === 'жен' || v === 'женский' || v === 'она' || v === 'f') return 'female';
  return 'auto';
}

export function cfgOf(env) {
  return { gender: normalize((env || {}).AGENT_GENDER) };
}

const CLAUSE = {
  male:
    'Род агента — мужской: о себе говори «я рад», «я готов», «я сказал». Это только про\n'
    + 'окончания твоих слов о себе и ничего больше.',
  female:
    'Род агента — женский: о себе говори «я рада», «я готова», «я сказала». Это только про\n'
    + 'окончания твоих слов о себе и ничего больше.',
};

/** Как обращаться ко второму лицу, когда пол собеседника известен. */
const USER_CLAUSE = {
  male: 'Собеседник — мужчина: обращайся к нему во втором лице в мужском роде — «ты сказал»,\n'
    + '«ты рад», «ты сам». Не путай его окончания со своими: род агента и его род — разные вещи.',
  female: 'Собеседник — женщина: обращайся к ней во втором лице в женском роде — «ты сказала»,\n'
    + '«ты рада», «ты сама». Не путай её окончания со своими: род агента и её род — разные вещи.',
};

const COMBO = 'Род агента и пол собеседника независимы: любая пара — и одинаковая тоже — обычная,\n'
  + 'её не комментируют и странной не считают.';
const ROLEPLAY = 'В ролевой сцене говори родом персонажа, которого играешь; вне сцены — своим, как выше.';

/**
 * Как обращаться к человеку — общая строка на все режимы: именно здесь
 * отрезается доминирующий тон.
 */
const ADDRESS =
  'К человеку — ровным тоном, на его языке и в его регистре: без поучений, без\n'
  + 'повелительных форм («очнись», «соберись»), без «мальчик мой» и «дорогая», без\n'
  + 'сюсюканья и без превосходства. Форма обращения — та, которую он сам выбрал в\n'
  + 'разговоре; если не выбирал — нейтральная, без рода и без имён.';

/** Явные способы сказать «авто» — они отличаются от мусора в поле запроса. */
const AUTO_WORDS = ['auto', 'авто', 'автоматически', 'как обычно', 'нейтрально', 'neutral', 'none'];

/**
 * Значение настройки, если оно распознано; '' — если в поле лежит что-то непонятное.
 * Отдельно от normalize() затем, чтобы чужая чушь в запросе не затырала настройку
 * развертывания: unrecognized = «человек ничего не выбирал».
 */
export function pick(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (!v) return '';
  const g = normalize(v);
  if (g !== 'auto') return g;
  return AUTO_WORDS.indexOf(v) >= 0 ? 'auto' : '';
}

/**
 * Пол собеседника из того, что реально приезжает: отдельное поле двери,
 * объект профиля (прямые вызовы) или строка «Пол: …» в текстовом блоке
 * профиля (продовый путь до 0.204 — из-за неё подстройка и не работала).
 */
export function userGenderOf(input) {
  const inp = input || {};
  const direct = pick(inp.userGender) || pick(inp.profileGender);
  if (direct && direct !== 'auto') return direct;
  if (inp.profile && typeof inp.profile === 'object') {
    const g = pick(inp.profile.gender);
    if (g && g !== 'auto') return g;
  }
  if (typeof inp.profile === 'string') {
    const m = /(?:^|\n)\s*·?\s*Пол:\s*(Мужской|Женский|male|female|М|Ж)(?![а-яёa-z])/i.exec(inp.profile);
    if (m) {
      const g = normalize(m[1]);
      if (g !== 'auto') return g;
    }
  }
  return 'auto';
}

/**
 * Эффективная пара {agent, user, source}: род агента из настройки, при
 * `auto` — из пола собеседника; пол собеседника не выдумывается ни из
 * имени, ни из манеры речи — только из того, что он сам указал.
 */
export function effective(input, env) {
  const setting = resolve(input, env);
  const user = userGenderOf(input);
  if (setting !== 'auto') return { agent: setting, user, source: 'настройка' };
  if (user !== 'auto') return { agent: user, user, source: 'по полу собеседника' };
  return { agent: 'auto', user: 'auto', source: 'авто' };
}

function compose(agent, user) {
  const lines = [];
  if (agent === 'male' || agent === 'female') lines.push(CLAUSE[agent]);
  if (user === 'male' || user === 'female') lines.push(USER_CLAUSE[user]);
  if ((agent === 'male' || agent === 'female') && (user === 'male' || user === 'female')) lines.push(COMBO);
  if (agent === 'male' || agent === 'female') lines.push(ROLEPLAY);
  lines.push(ADDRESS);
  return '\n\n' + lines.join('\n');
}

/** Кусок в system. Для `auto` род агента определяется по полу пользователя. */
export function block(gender, userGender) {
  const setting = normalize(gender);
  const user = normalize(userGender);
  const agent = setting !== 'auto' ? setting : user;
  return compose(agent, user);
}

/**
 * Что использовать как настройку агента: выбор из запроса, а если его нет
 * или он нераспознан — env `AGENT_GENDER`. Явное «авто» в запросе — тоже
 * выбор, оно не превращается в настройку развертывания.
 */
export function resolve(input, env) {
  const fromReq = pick(input && input.gender);
  if (fromReq) return fromReq;
  const fromEnv = pick((env || {}).AGENT_GENDER);
  return fromEnv || 'auto';
}

/** То же, что effective, но уже текстом для system-подсказки. */
export function blockFor(input, env) {
  const eff = effective(input, env);
  return compose(eff.agent, eff.user);
}

/** Что сейчас установлено — для диагностики и подписи в ответе. */
export function label(gender) {
  const g = normalize(gender);
  return g === 'male' ? 'мужской' : g === 'female' ? 'женский' : 'авто';
}

export const GENDER_CHOICES = [
  { value: 'auto', title: 'Авто', hint: 'агент сам определит по разговору' },
  { value: 'male', title: 'Мужской', hint: '«я рад», «я готов»' },
  { value: 'female', title: 'Женский', hint: '«я рада», «я готова»' },
];

/* ── Починка окончаний о себе ──────────────────────────────────────────────
   Модель знает настройку, но бесплатные головы регулярно сползают в мужской
   род по умолчанию («я понял» при женском роде агента). Чиним только
   бесспорное: «я + слово» (с «не/уже/только» между) из закрытого списка
   пар. Третье лицо и чужая прямая речь не трогаются по построению —
   там подлежащее не «я» агента. Творческие тексты движок сюда не пускает
   (рассказчик может быть кем угодно), см. вызов в chat.js. */

const M2F = {
  'был': 'была', 'рад': 'рада', 'готов': 'готова', 'сказал': 'сказала',
  'сделал': 'сделала', 'понял': 'поняла', 'пришёл': 'пришла', 'пришел': 'пришла',
  'написал': 'написала', 'подумал': 'подумала', 'решил': 'решила',
  'ответил': 'ответила', 'посмотрел': 'посмотрела', 'нашёл': 'нашла', 'нашел': 'нашла',
  'проверил': 'проверила', 'посчитал': 'посчитала', 'уверен': 'уверена',
  'согласен': 'согласна', 'должен': 'должна', 'виноват': 'виновата',
  'доволен': 'довольна', 'занят': 'занята', 'сам': 'сама', 'один': 'одна',
};
const F2M = Object.fromEntries(Object.entries(M2F).map(([m, f]) => [f, m === 'пришел' ? 'пришёл' : m === 'нашел' ? 'нашёл' : m]));

export function repair(text, agentGender) {
  const g = normalize(agentGender);
  const raw = String(text == null ? '' : text);
  if (g === 'auto' || !raw) return raw;
  const map = g === 'female' ? M2F : F2M;
  const words = Object.keys(map).sort((a, b) => b.length - a.length).join('|');
  const re = new RegExp('(?<![а-яё])(я)(\\s+(?:не|уже|только|всё|все)\\s+|\\s+)(' + words + ')(?![а-яё])', 'gi');
  return raw.replace(re, (whole, ya, mid, word) => {
    const form = map[String(word).toLowerCase()];
    if (!form) return whole;
    const fixed = /^[А-ЯЁ]/.test(word) ? form.charAt(0).toUpperCase() + form.slice(1) : form;
    return ya + mid + fixed;
  });
}
