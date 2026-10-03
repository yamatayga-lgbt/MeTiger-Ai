/**
 * Клиент двигателя (Этап 1 переноса из Yama AI).
 *
 * Один вызов POST /api/chat: тот же путь отдают и локальный `vite` (proxy в
 * vite.config.ts), и Pages Function на проде. Ответ — не «текст или ничего»:
 * вместе с текстом приходят провайдер, модель и намерение классификатора. По ним
 * и видно, кто сейчас говорит с человеком; без них любой сбой выглядит как
 * «модель тупит», хотя на деле кончилась квота у одного провайдера.
 *
 * Демо-ответы из mock.ts остаются только режимом разработки. В проде честная
 * ошибка лучше, чем красивая заглушка, выданная за ответ агента.
 */

import { currentUserId, memoryAddress } from './identity'

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface SourceLink {
  title: string
  url: string
}

export interface ChatResult {
  ok: boolean
  reply: string
  provider?: string
  model?: string
  intent?: string
  tier?: string
  ms?: number
  /** Почему не вышло — словом, чтобы это можно было показать человеку. */
  error?: string
  /** Что перебрал движок: провайдеры и причины. */
  tried?: { provider: string; model?: string; why?: string }[]
  /** Какую модель выбрал человек, если до неё не дошло. */
  pinned?: string
  /** Выбранная модель не ответила — говорили другой. */
  pinMiss?: boolean
  /** Вердикт совета голов словами (пусто — значит совет молчал). */
  ensemble?: string
  /** Вердикт совета зрячих голов по картинке. */
  vision?: string
  /** Какие инструменты агента накормили ответ (web-search, news, calc…). */
  tools?: string[]
  /** Проверенные ссылки из поиска, вики, новостей или прочитанной страницы. */
  sources?: SourceLink[]
  /** Навыки, которые включились по смыслу вопроса (engine/skills.js). */
  skills?: string[]
  /** Документы, которые модель оформила файлом: имя, mime, вес и base64 целиком. */
  files?: { name: string; mime: string; size: number; b64: string; kind?: string; source?: string }[]
  /** Почему вложение не вышло: «картинка не вышла: gemini: 429 …». Пусто — значит всё дошло. */
  fileError?: string
  /** Текст изменён большинством — это надо показать, а не спрятать. */
  ensembleApplied?: boolean
  visionApplied?: boolean
  /** Род агента, которым отвечали: 'male' | 'female' | 'auto'. */
  gender?: string
  /** Чем движок оплатил нормальный вход: обрезанный «system», лишние реплики… */
  inputNotes?: string[]
  /** Чем оплатил окно модели: сколько реплик истории ушло и что подрезали. */
  ctxFit?: string
  /** Что прочитал из приложенных файлов (имя · формат · знаков) и почему остальное не дошло. */
  attachments?: { name: string; ok: boolean; line: string }[]
  attachNotes?: string[]
  /** Что движок прочитал в форме последней реплики (только при EMOTION_LABEL=1). */
  emotion?: { id: string; emoji: string; label: string; confidence: number }

  /** Поток оборвался в самом конце: текст есть, хвоста нет. Отдельная строка, не ошибка. */
  streamError?: string
  /** Что модель написала себе перед ответом (у упрямых провайдеров — в отдельном поле). */
  reasoning?: string
}

export interface SseEvent {
  kind: string
  /** `reasoning` — кусок рассуждений; пусто — это кусок самого ответа. */
  channel?: string
  provider?: string
  model?: string
  text?: string
  status?: number
  payload?: unknown
}

/**
 * Разбор SSE-буфера: съедаются только целые блоки до пустой строки, хвост отдаётся назад —
 * кусок сети может разорвать строку посреди слова. Функция вынесена и экспортирована,
 * потому что именно на ней ломается потоковый ответ и именно её надо уметь проверить
 * без браузера.
 */
export function parseSse(buf: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = []
  let i = 0
  for (;;) {
    const cut = buf.indexOf('\n\n', i)
    if (cut < 0) break
    const block = buf.slice(i, cut)
    i = cut + 2
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue
      const raw = line.slice(5).trim()
      if (!raw || raw === '[DONE]') continue
      try {
        const o = JSON.parse(raw)
        if (o && typeof o === 'object') events.push(o as SseEvent)
      } catch (e) {
        /* строка пришла рваной — ждём продолжения в следующем чанке */
      }
    }
  }
  return { events, rest: buf.slice(i) }
}

/** Читает поток ответа, показывает черновик и возвращает финальный payload (или null). */
async function readDraftStream(
  res: Response,
  onDraft?: (text: string | null) => void,
  onReasoning?: (text: string | null) => void,
): Promise<Partial<ChatResult> | null> {
  const rd = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null
  if (!rd) return null
  const dec = new TextDecoder()
  let buf = ''
  let draft: string | null = null
  let final: Partial<ChatResult> | null = null
  let reason: string | null = null;
  for (;;) {
    const r = await rd.read()
    if (r.done) break
    buf += dec.decode(r.value, { stream: true })
    const got = parseSse(buf)
    buf = got.rest
    for (const ev of got.events) {
      if (ev.kind === 'draft' && ev.channel === 'reasoning') {
        reason = (reason || '') + String(ev.text || '')
        if (onReasoning) onReasoning(reason)
      } else if (ev.kind === 'draft') {
        draft = (draft || '') + String(ev.text || '')
        if (onDraft) onDraft(draft)
      } else if (ev.kind === 'drop') {
        // попытка ушла в запасной пул: обрывки нельзя оставлять ни в одном канале,
        // иначе половина текста предыдущей головы висит под новой
        draft = null
        reason = null
        if (onDraft) onDraft(null)
        if (onReasoning) onReasoning(null)
      } else if (ev.kind === 'final' && ev.payload && typeof ev.payload === 'object') {
        final = ev.payload as Partial<ChatResult>
      }
    }
  }
  return final
}


const ENDPOINT = (import.meta.env?.VITE_API_BASE || '') + '/api/chat'

/**
 * Что человек приложил к сообщению в браузере. Файл едет base64-ом в теле запроса:
 * своего хранилища под выдачу и приём нет, а 4 МБ на файл и 8 МБ на запрос — потолок,
 * выше которого Pages Function обрезает запрос раньше, чем мы успеем что-то прочитать.
 */
export interface Attachment {
  name: string
  mime: string
  size: number
  b64: string
  kind: 'file' | 'voice' | 'image'
}

import { looksLikeImage } from './images'

export const ATTACH_MAX = 3
export const ATTACH_FILE_BYTES = 4 * 1024 * 1024
/** Что пускаем в диалог выбора: картинки + читаемые форматы + любой аудиофайл. */
export const ATTACH_ACCEPT =
  'image/*,.pdf,.docx,.xlsx,.pptx,.csv,.tsv,.md,.txt,.json,.xml,.html,audio/*,.ogg,.opus,.webm,.mp3,.m4a,.wav'

export function attachmentKind(f: { name?: string; type?: string }): 'image' | 'voice' | 'file' {
  const mime = (f.type || '').toLowerCase()
  const name = (f.name || '').toLowerCase()
  /* Правило картинки одно на весь клиент — из src/lib/images: телефонные фото приходят
     с пустым type и по MIME не опознаются совсем. */
  if (looksLikeImage({ name: f.name, type: f.type })) return 'image'
  if (mime.startsWith('audio/') || /\.(ogg|opus|webm|mp3|m4a|aac|wav|amr)$/.test(name)) return 'voice'
  return 'file'
}

/**
 * Отсортировать выбранное: что возьмём, что слишком тяжёлое, что лишнее по количеству.
 * Чистой функцией — чтобы отказ «почему мой файл не прочитали» можно было проверить
 * без браузера и без сети.
 */
export function pickAttachments(
  list: { name: string; type?: string; size: number }[],
  max = ATTACH_MAX,
  maxBytes = ATTACH_FILE_BYTES,
): { taken: { name: string; type: string; size: number }[]; tooBig: string[]; extra: number } {
  const taken: { name: string; type: string; size: number }[] = []
  const tooBig: string[] = []
  let skipped = 0
  for (const f of list || []) {
    if (!f || !f.name) { skipped++; continue }
    if (f.size > maxBytes) { tooBig.push(`${f.name}: ${fileSize(f.size)} — больше ${fileSize(maxBytes)}, не читаем`); continue }
    if (taken.length >= max) { skipped++; continue }
    taken.push({ name: f.name, type: f.type || '', size: f.size })
  }
  return { taken, tooBig, extra: skipped }
}

/** ArrayBuffer → base64 чанками: один fromCharCode на 4 МБ кладёт стек вызовов. */
export function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)) as number[])
  return btoa(s)
}

/** Файл → приложение для запроса. Ошибку возвращаем словом, а не исключением. */
export async function fileToAttachment(file: File): Promise<{ ok: true; att: Attachment } | { ok: false; error: string }> {
  const kind = attachmentKind(file)
  if (file.size > ATTACH_FILE_BYTES) return { ok: false, error: `${file.name}: ${fileSize(file.size)} — больше ${fileSize(ATTACH_FILE_BYTES)}` }
  if (!file.size) return { ok: false, error: `${file.name}: пустой файл` }
  try {
    const buf = await file.arrayBuffer()
    return { ok: true, att: { name: file.name, mime: file.type || '', size: file.size, b64: bufToB64(buf), kind } }
  } catch (e) {
    return { ok: false, error: `${file.name}: не удалось прочитать (${(e as Error)?.message || 'ошибка чтения'})` }
  }
}

/** Чем подписать ответ по приложенным файлам: что прочитано и что не дошло. */
export function attachLine(r: ChatResult): string {
  const read = (r.attachments || []).map((a) => (a.ok ? `${a.name} · ${a.line}` : `${a.name} — ${a.line}`))
  const notes = (r.attachNotes || []).map((n) => `· ${n}`)
  return read.concat(notes).join('\n')
}

/** Что движок подправил на входе и в окне — одной строкой, чтобы это было видно под ответом. */
export function notesLine(r: ChatResult): string {
  const parts = [...(r.inputNotes || []), r.ctxFit].map((x) => (x || '').trim()).filter(Boolean)
  return parts.join(' · ')
}

/* ============================================================
   Профиль человека и счётчик моделей — данные вне разговора.
   ============================================================ */

export interface ProfileFields {
  name: string
  job: string
  about: string
}

export interface ProfileData extends ProfileFields {
  filled?: boolean
  updatedAt?: number
}

export interface ProfileResult {
  ok: boolean
  error?: string
  profile?: ProfileData
  block?: string
  signals?: string[]
  memoryChatId?: string
  stored?: boolean
  truncated?: string[]
  unchanged?: boolean
  tooSoon?: boolean
}

const API = (path: string) => `${(import.meta.env?.VITE_API_BASE || '') + path}`

/** Все ответы /api/profile одной формы: сеть может ответить чем угодно, а UI ждёт поля. */
function asProfile(data: Partial<ProfileResult> | null, ok: boolean, status: number): ProfileResult {
  if (!data || typeof data !== 'object') return { ok: false, error: ok ? 'пустой ответ сервера' : `сервер ответил ${status}` }
  if (!data.ok) return { ok: false, error: data.error || `сервер ответил ${status}`, tooSoon: !!data.tooSoon }
  return {
    ok: true,
    profile: data.profile,
    block: data.block || '',
    signals: data.signals || [],
    memoryChatId: data.memoryChatId,
    stored: !!data.stored,
    truncated: data.truncated,
    unchanged: !!data.unchanged,
  }
}

async function profileRequest(method: string, body?: unknown): Promise<ProfileResult> {
  const userId = currentUserId()
  try {
    const res = await fetch(API('/api/profile?id=' + encodeURIComponent(userId)), {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(Object.assign({ userId }, body)) : undefined,
    })
    const data = (await res.json().catch(() => null)) as Partial<ProfileResult> | null
    return asProfile(data, res.ok, res.status)
  } catch {
    return { ok: false, error: 'сеть недоступна — профиль не прочитан' }
  }
}

export function fetchProfile(): Promise<ProfileResult> {
  return profileRequest('GET')
}

export function saveProfile(fields: ProfileFields): Promise<ProfileResult> {
  return profileRequest('PUT', { name: fields.name, job: fields.job, about: fields.about })
}

export function clearProfile(): Promise<ProfileResult> {
  return profileRequest('DELETE')
}

/** Чем подписать состояние профиля: тот же текст, что видит модель, а не догадка фронта. */
export function signalsLine(r: ProfileResult): string {
  const sig = (r.signals || []).filter(Boolean)
  if (!sig.length) return 'подстройка не включена: заполни поля — и я учту их в каждом ответе'
  return sig.join(' · ')
}

/** Что и куда легло: адрес памяти человека — не «где-то там», а конкретный ключ. */
export function profileStatusLine(r: ProfileResult): string {
  const p = r.profile
  if (!r.ok) return r.error || 'профиль не прочитан'
  const addr = r.memoryChatId || memoryAddress(currentUserId())
  const head = p && p.filled ? 'профиль сохранён' : 'профиль пуст'
  return head + ' · ' + identityLabelOf(addr) + (p && p.updatedAt ? ' · обновлён ' + fmtTime(p.updatedAt) : '')
}

/** «u-ab12…» → читаемая форма; сам ключ остаётся видимым, чтобы его можно было назвать. */
function identityLabelOf(addr: string): string {
  const key = String(addr || '')
  if (key.indexOf('u-tg_') === 0) return 'память: Telegram (id ' + key.slice(5) + ')' /* ключи бота: чистим по-прежнему */
  if (key.indexOf('u-') === 0) return 'память: это устройство (' + key.slice(2) + ')'
  return 'память: общий ключ «' + (key || 'web') + '» — заполни профиль, и она станет личной'
}

function fmtTime(ms: number): string {
  const d = new Date(ms)
  if (!Number.isFinite(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

/**
 * Счётчик моделей одной строкой. Чистая функция от двух ответов (/api/models и
 * /api/chat), чтобы её можно было проверить без сети и чтобы цифры не сочинялись
 * на фронте: здесь ровно то, что посчитал сервер.
 */
export function countersLine(models?: unknown, chat?: unknown): string {
  const parts: string[] = []
  const m = (models && typeof models === 'object' ? models : null) as {
    count?: number; catalogTotal?: number; catalogCount?: number; pools?: { provider?: string; label?: string; count?: number }[]
    updatedAt?: number | null; cached?: boolean; stale?: boolean; errors?: unknown[]
  } | null
  /* Считать есть что, только если сервер назвал хотя бы одно число. Иначе из `{}`
     получилась бы строка «моделей доступно: 0» — по букве правдивая, по смыслу ложная:
     ноль означает «не ответило», а не «моделей нет». */
  if (m && (m.count != null || m.catalogCount != null || m.catalogTotal != null || Array.isArray(m.pools))) {
    const total = Number(m.count) || 0
    const cat = Number(m.catalogTotal) || Number(m.catalogCount) || 0
    parts.push('моделей доступно: ' + total + (cat > total ? ' (в каталогах провайдеров: ' + cat + ')' : ''))
    const pools = Array.isArray(m.pools) ? m.pools : []
    if (pools.length) {
      parts.push('по провайдерам: ' + pools.map((x) => (x.label || x.provider || '?') + ' ' + (Number(x.count) || 0)).join(', '))
    }
    parts.push(m.updatedAt ? 'каталог обновлён ' + fmtTime(Number(m.updatedAt)) : 'каталог ещё не обновлялся')
    if (m.cached === false) parts.push('без KV список живёт до перезапуска')
    if (m.stale) parts.push('список устарел')
    if (Array.isArray(m.errors) && m.errors.length) parts.push('каталог: ' + m.errors.length + ' ошибок чтения')
  }
  const c = (chat && typeof chat === 'object' ? chat : null) as { alive?: unknown[]; providers?: number } | null
  if (c && (c.providers != null || Array.isArray(c.alive))) {
    const alive = Array.isArray(c.alive) ? c.alive.length : 0
    const total = Number(c.providers) || 0
    if (total) parts.push('живых провайдеров: ' + alive + ' из ' + total)
  }
  return parts.join(' · ')
}

/** Итого счётчик для строки в Настройках: два GET, и оба необязательны. */
export async function fetchCounters(): Promise<{ ok: boolean; line: string; error?: string }> {
  const [m, c] = await Promise.all([
    fetch(API('/api/models')).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(API('/api/chat')).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ])
  const line = countersLine(m, c)
  if (line) return { ok: true, line }
  return { ok: false, line: 'сервер не отдал список моделей', error: 'нет связи с /api/models' }
}

export async function sendChat(
  text: string,
  history: ChatTurn[] = [],
  opts: {
    signal?: AbortSignal
    images?: string[]
    attachments?: Attachment[]
    model?: string
    gender?: string
    /**
     * Живой черновик. Если он задан, у сервера просится поток (`accept: text/event-stream`):
     * на каждом куске провайдера сюда приходит накопленный текст, а `null` значит «сбрось —
     * эта попытка не пойдёт в ответ». Без колбэка запрос и ответ остаются ровно прежними.
     */
    onDraft?: (text: string | null) => void
    /**
     * То же, но про рассуждения: у них отдельный канал потока, и приходят они ДО ответа.
     * Просим их только когда переключатель включён — сервер без просьбы их не шлёт.
     */
    onReasoning?: (text: string | null) => void
    /**
     * Явный запрос глубокого поиска («поиск» в панели ввода): принудительно зовёт
     * web-search и читает первую найденную страницу, даже без слова «погугли».
     */
    webSearch?: boolean
  } = {},
): Promise<ChatResult> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 75_000)
  if (opts.signal) opts.signal.addEventListener('abort', () => ac.abort(), { once: true })
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: opts.onDraft
        ? { 'content-type': 'application/json', accept: 'text/event-stream' }
        : { 'content-type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        text,
        history: history.slice(-8),
        images: opts.images,
        attachments: opts.attachments && opts.attachments.length ? opts.attachments : undefined,
        model: opts.model || undefined,
        gender: opts.gender || undefined,
        /* явная просьба показать, как модель думала; без неё сервер в этом канале молчит */
        showReasoning: opts.onReasoning ? true : undefined,
        /* явная просьба глубокого поиска в сети; без неё работают только собственные триггеры */
        webSearch: opts.webSearch ? true : undefined,
        /* кто пишет: по этому ключу бэкенд держит память и профиль. Без него весь
           веб делил одну память на всех незнакомцев */
        userId: currentUserId(),
      }),
    })
    let data: Partial<ChatResult> | null
    if ((opts.onDraft || opts.onReasoning) && (res.headers.get('content-type') || '').indexOf('text/event-stream') >= 0) {
      // Поток: куски идут в onDraft, финальное событие несёт ровно тот payload, который
      // сервер вернул бы обычным POST. Демонстрационный путь сюда не заходит.
      const fin = (await readDraftStream(res, opts.onDraft, opts.onReasoning)) as Partial<ChatResult> | null
      if (!fin) {
        // сервер закрыл поток, так и не досказав финал: это отдельный отказ, а не
        // «сервер ответил 200» — иначе человек читает про статус там, где пропущен хвост
        return { ok: false, reply: '', error: 'ответ оборвался на середине' }
      }
      data = fin
    } else {
      data = (await res.json().catch(() => null)) as Partial<ChatResult> | null
    }
    if (!res.ok || !data) {
      return { ok: false, reply: '', error: (data && data.error) || `сервер ответил ${res.status}`, tried: data?.tried }
    }
    return { ok: true, reply: data.reply || '', ...data }
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError'
    return { ok: false, reply: '', error: aborted ? 'время вышло' : 'сеть недоступна' }
  } finally {
    clearTimeout(timer)
  }
}


/**
 * Чем подписать ответ: кто говорил и что сказал совет.
 *
 * Совет не должен оставаться внутренней кухней движка. «сошлись 3/3» и
 * «Головы не сошлись» — это ровно то, что отличает проверку от угадывания, и
 * человек это видит. Тон подбирается по смыслу строк, а не по их наличию:
 * промолчавший совет не кричит, исправленный ответ — подсвечен.
 */
export type AdviceTone = 'ok' | 'warn' | 'quiet'

const OK_LINE = /сошлись\s+\d+\/\d+|подтверждаю|confirmed/i
const WARN_LINE = /не сошлись|разошлись|overruled|взято большинство|большинство/i

export function adviceLine(r: ChatResult): { text: string; tone: AdviceTone } | null {
  const parts = [r.ensemble, r.vision].map((x) => (x || '').trim()).filter(Boolean)
  if (!parts.length) return null
  const text = parts.join(' · ')
  const changed = r.ensembleApplied === true || r.visionApplied === true
  if (WARN_LINE.test(text) || changed) return { text, tone: 'warn' }
  if (OK_LINE.test(text)) return { text, tone: 'ok' }
  return { text, tone: 'quiet' }
}

/** Короткая строка «кто ответил» — для отладочной подписи под сообщением. */
const TOOL_RU: Record<string, string> = {
  'web-search': 'веб-поиск',
  news: 'новости',
  wikipedia: 'вики',
  url: 'страница',
  calc: 'калькулятор',
  currency: 'курсы',
  weather: 'погода',
  time: 'время',
  date: 'дата',
  random: 'случайность',
  coin: 'монетка',
  dice: 'кубики',
  joke: 'шутка',
  'image-search': 'поиск картинок',
  filegen: 'файл',
}

/** Сколько весят файлы по-человечески: байты не округляем до «0 КБ». */
export function fileSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} б`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} КБ`
  return `${(n / 1048576).toFixed(2).replace('.', ',')} МБ`
}

/** data-URI для скачивания: своего хранилища под выдачу нет, файл живёт в ответе. */
export function fileHref(f: { mime: string; b64: string }): string {
  return `data:${f.mime || 'application/octet-stream'};base64,${f.b64}`
}

export function sourceLine(r: ChatResult): string {
  if (!r.ok || !r.provider) return ''
  const tools = (r.tools || []).map((t) => TOOL_RU[t] || t)
  return (
    `${r.provider} · ${r.model || '?'} · ${r.intent || '?'}/${r.tier || '?'} · ${r.ms ?? 0} мс` +
    (r.pinMiss && r.pinned ? ` · ${r.pinned} не ответил` : '') +
    (tools.length ? ` · данные: ${tools.join(', ')}` : '') +
    /* навыки — чем модель себя правила; коротко, чтобы строка не расползалась */
    ((r.skills || []).length ? ` · навыки: ${(r.skills || []).slice(0, 3).join(', ')}${(r.skills || []).length > 3 ? ' +' + ((r.skills || []).length - 3) : ''}` : '') +
    ((r.files || []).length ? ` · файлы: ${(r.files || []).length}` : '') +
    /* состояние собеседника — если его включили (EMOTION_LABEL=1); без него строка
       выглядит ровно как раньше */
    (r.emotion ? ` · ${r.emotion.emoji} ${r.emotion.label}` : '') +
    /* эффективный род, которым агент реально ответил (auto не показываем — он ничего
       не обещает) */
    (r.gender && r.gender !== 'auto' ? ` · род: ${r.gender === 'female' ? 'женский' : 'мужской'}` : '')
  )
}
