/* ============================================================
   Настройка «род агента»: Авто / Мужской / Женский.
   Хранится в localStorage под тем же ключом, который пишет меню
   «Настройки → Ассистент», поэтому чтение из отправки запроса и из настроек
   не разъезжаются. Значение проверяется: из хранилища может прилететь что
   угодно, а это текст, который уедет в подсказку модели.
   ============================================================ */

export type Gender = 'auto' | 'male' | 'female'

export const GENDER_KEY = 'mt-gender'

const VALUES: string[] = ['auto', 'male', 'female']

export function isGender(v: unknown): v is Gender {
  return typeof v === 'string' && VALUES.indexOf(v) >= 0
}

/** Подписи для меню. Порядок = порядок кнопок в Segmented. */
export const GENDER_CHOICES: { value: Gender; title: string; hint: string }[] = [
  { value: 'auto', title: 'Авто', hint: 'агент сам определит по разговору' },
  { value: 'male', title: 'Мужской', hint: '«я рад», «я готов»' },
  { value: 'female', title: 'Женский', hint: '«я рада», «я готова»' },
]

type Store = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void }

function local(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : (localStorage as unknown as Store)
  } catch {
    return null
  }
}

/** Что стоит сейчас. Любая грязь в хранилище читается как «авто», а не как ошибка. */
export function readGender(s: Store | null = local()): Gender {
  if (!s) return 'auto'
  try {
    const raw = s.getItem(GENDER_KEY)
    if (raw === null) return 'auto'
    const parsed: unknown = JSON.parse(raw)
    return isGender(parsed) ? parsed : 'auto'
  } catch {
    return 'auto'
  }
}

/**
 * Запись настройки для нефронтовых вызывающих (тесты, будущий импорт настроек,
 * команда бота). Меню приложения пишет через usePersistentState — тот же ключ и тот
 * же формат, поэтому два пути совместимы.
 */
export function writeGender(gender: Gender, s: Store | null = local()): void {
  if (!s) return
  try {
    s.setItem(GENDER_KEY, JSON.stringify(isGender(gender) ? gender : 'auto'))
  } catch {
    /* приватный режим или переполнение — настройка не критична */
  }
}

/**
 * Значение для тела запроса. `auto` не отправляем вовсе: на сервере для него есть
 * свой дефолт `AGENT_GENDER`, и человек с авто в браузере не перебивает
 * настройку развертывания.
 */
export function genderForRequest(gender: Gender): Gender | undefined {
  return gender === 'auto' ? undefined : gender
}
