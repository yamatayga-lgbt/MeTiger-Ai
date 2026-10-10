/* ============================================================
   Карточка человека. Имя — из профиля, адрес памяти — из ключа устройства.
   ============================================================ */

/* Зачем. Имя, аватар и «ты в Telegram» раньше приезжали из вебвью бота. Бота нет,
   и карточка не должна врать: человек видит то, что сайт знает на самом деле —
   имя, которое он сам записал в Настройках, и подпись ключа, под которым лежит
   его память. Язык берём у браузера: он нужен подсказке распознавания голоса. */

import { ensureDeviceUserId, identityLine } from './identity'

export interface Person {
  name: string
  handle: string
  photo_url: string
  language_code: string
}

/* Экран настроек пишет профиль на сервер; здесь та же строка лежит рядом, чтобы
   приветствие в чате и сидбар обновлялись без лишнего запроса. */
const NAME_KEY = 'mt-person-name'

function storedName(): string {
  try {
    return String((globalThis as { localStorage?: Storage }).localStorage?.getItem(NAME_KEY) || '')
  } catch {
    return ''
  }
}

export function savePersonName(name: string): void {
  try {
    const box = (globalThis as { localStorage?: Storage }).localStorage
    const v = String(name || '').trim()
    if (v) box?.setItem(NAME_KEY, v)
    else box?.removeItem(NAME_KEY)
  } catch {
    /* не сохранилось — имя просто останется «Гость» до следующей записи */
  }
}

function browserLang(): string {
  /* `readonly string[]` — таким его видит TS; свой список удобнее не копировать. */
  const nav = globalThis.navigator as { language?: string; languages?: readonly string[] } | undefined
  const raw = String((nav && (nav.language || (nav.languages && nav.languages[0]))) || 'ru')
  return raw.slice(0, 35) || 'ru'
}

export function siteUser(): Person {
  return {
    name: storedName().trim() || 'Гость',
    handle: identityLine(ensureDeviceUserId()),
    photo_url: '',
    language_code: browserLang(),
  }
}

export function initials(person: Person): string {
  const parts = String(person.name || '').split(/\s+/).filter(Boolean).slice(0, 2)
  const firstGrapheme = (word: string) => {
    const chars = Array.from(word.normalize('NFC'))
    if (!chars.length) return ''
    let first = chars[0]
    for (let i = 1; i < chars.length && /\p{M}/u.test(chars[i]); i++) first += chars[i]
    return first
  }
  const out = parts.map((w) => firstGrapheme(w).toUpperCase()).join('')
  return out || 'Г'
}

export function displayName(person: Person): string {
  return String(person.name || '').trim() || 'Гость'
}
