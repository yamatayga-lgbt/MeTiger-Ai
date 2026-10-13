/**
 * Род агента — настройка человека + подстройка под пол пользователя.
 *
 * Род агента может настраиваться вручную (меню «Настройки → Ассистент → Род агента»)
 * или автоматически подстраиваться под пол пользователя из профиля.
 * 
 * Значение приходит из приложения (меню «Настройки → Ассистент → Род агента»),
 * из `/api/chat` полем `gender`, или по умолчанию из env `AGENT_GENDER`.
 * `auto` — род определяется по полу пользователя из профиля, если он указан.
 * Если пол пользователя не указан, модель берёт род из PERSONA_SYSTEM и разговора.
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

/**
 * Как обращаться к человеку — отдельная строка, и она одна на все режимы, включая
 * `auto`: именно здесь отрезается доминирующий тон.
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

/** Кусок в system. Для `auto` род определяется по полу пользователя. */
export function block(gender, userGender) {
  const g = normalize(gender);
  const u = normalize(userGender);
  
  // Если явно указан род агента (не auto), используем его
  if (g && g !== 'auto') {
    return '\n\n' + CLAUSE[g] + '\n' + ADDRESS;
  }
  
  // Если род агента auto, но указан пол пользователя — подстраиваемся под пользователя
  if (u && u !== 'auto') {
    return '\n\n' + CLAUSE[u] + '\n'
      + 'Подстраиваюсь под пол пользователя. ' + ADDRESS;
  }
  
  // Иначе — только обращение
  return '\n\n' + ADDRESS;
}

/**
 * Что использовать: выбор из запроса, а если его нет или он нераспознан — env
 * `AGENT_GENDER`. Явное «авто» в запросе — тоже выбор, оно не превращается в
 * настройку развертывания.
 */
export function resolve(input, env) {
  const fromReq = pick(input && input.gender);
  if (fromReq) return fromReq;
  const fromEnv = pick((env || {}).AGENT_GENDER);
  return fromEnv || 'auto';
}

/** То же, что resolve, но уже текстом для system-подсказки. */
export function blockFor(input, env) {
  const agentGender = resolve(input, env);
  const userGender = (input && input.profile && typeof input.profile === 'object') 
    ? (input.profile.gender || '') 
    : '';
  return block(agentGender, userGender);
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
