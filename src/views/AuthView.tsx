/**
 * Вход и регистрация (0.174) — первый экран приложения.
 *
 * Владелец попросил: «добавим вход в аккаунты, основа будет через Google, но можно
 * и другие способы: TikTok, Instagram, VK, Discord, Facebook. Не только вход, но и
 * регистрация. Если забыл пользователь пароль, то ему на указанную почту поступает
 * пароль». Гость с 0.174 убран сознательно: память, профиль и обращения живут на
 * аккаунте, а не на устройстве — иначе человек терял бы всё при смене телефона.
 *
 * Экран один на две роли (вход и регистрация), как у больших приложений: человек
 * не должен угадывать, где он «ещё не зарегистрирован». Переключатель сверху,
 * живые подсказки под полями, кнопки сетей — только с ключами (сервер говорит,
 * какие включены: пустых кнопок не показываем).
 *
 * Честность важнее вида: «забыли пароль» работает только когда почтовый ключ
 * подключён, и если его нет — так и сказано, а не «письмо отправлено».
 */
import { useEffect, useMemo, useState } from 'react'
import { AtSign, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, LogIn } from 'lucide-react'
import {
  authOptions, loginAccount, recoverPassword, registerAccount, seenAccounts, startProvider,
  type ProviderInfo,
} from '../lib/auth'
import { Button } from '../components/ui'
import { haptic } from '../lib/haptic'
import { APP_VERSION } from '../lib/version'

interface AuthViewProps {
  /** Ошибка возврата от провайдера (?auth= в адресе) — показываем словами сервера. */
  notice?: string
  onDone: () => void
}

/* Порядок кнопок — от главного к остальным: владелец сказал «основа будет через
   Google», а сети идут следом. Подписи — названия сетей, без «войти через»:
   так строка не распухает и влезает на телефон. */
const PROVIDER_ORDER = ['google', 'vk', 'discord', 'facebook', 'instagram', 'tiktok']

export function AuthView({ notice = '', onDone }: AuthViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  /* Если с этого устройства входил ровно один человек, подставляем его почту сразу:
     пустое поле рядом с чипом «кто уже входил» выглядит поломкой — «мой адрес тут,
     а поле пустое». Пароль всё равно спрашиваем, вход без него невозможен. */
  const [email, setEmail] = useState(() => {
    const s = seenAccounts()
    return s.length === 1 ? s[0].email : ''
  })
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({})
  const [mail, setMail] = useState(true)
  const [seen] = useState(() => seenAccounts())

  useEffect(() => {
    void authOptions().then((o) => {
      setProviders(o.providers)
      setMail(o.mail)
    })
  }, [])

  useEffect(() => {
    if (notice) setError(notice)
  }, [notice])

  const живой = useMemo(() => email.trim().includes('@') && password.length >= 8, [email, password])

  const submit = async () => {
    if (busy) return
    setError('')
    setDone('')
    setBusy('submit')
    const r = mode === 'login'
      ? await loginAccount(email, password)
      : await registerAccount(email, password)
    setBusy('')
    if (!r.ok) {
      setError(String(r.error || 'не получилось'))
      return
    }
    haptic('medium')
    onDone()
  }

  const recover = async () => {
    if (busy) return
    setError('')
    setDone('')
    if (!email.trim().includes('@')) {
      setError('сначала укажите почту, которую вводили при регистрации')
      return
    }
    setBusy('recover')
    const r = await recoverPassword(email)
    setBusy('')
    /* При исправной почте сервер отвечает одинаково и для своего адреса, и для
       чужого: по ответам нельзя узнать, кто здесь зарегистрирован. */
    if (!r.ok) setError(String(r.error || 'письмо не ушло'))
    else setDone('Если такой адрес у нас есть, письмо с новым паролем уже в пути.')
  }

  const входы = PROVIDER_ORDER.map((id) => ({ id, ...(providers[id] || { title: id, on: false }) }))
    .filter((p) => p.on || providers[p.id])

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">MT</div>
          <div>
            <div className="auth-name">MeTiger Ai</div>
            <div className="auth-ver">версия {APP_VERSION}</div>
          </div>
        </div>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={`auth-tab${mode === 'login' ? ' is-on' : ''}`}
            onClick={() => { haptic('light'); setMode('login'); setError('') }}
          >
            Войти
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={`auth-tab${mode === 'register' ? ' is-on' : ''}`}
            onClick={() => { haptic('light'); setMode('register'); setError('') }}
          >
            Создать аккаунт
          </button>
        </div>

        <p className="auth-sub">
          {mode === 'login'
            ? 'Память, профиль и ваши обращения живут на аккаунте — вход с любого устройства.'
            : 'Почта нужна, чтобы вернуть доступ, если забудете пароль. Больше ничего ей не пишем.'}
        </p>

        {входы.length ? (
          <div className="auth-providers">
            {входы.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`auth-prov${p.on ? '' : ' is-off'}`}
                disabled={!p.on}
                title={p.on ? 'Войти через ' + p.title : p.title + ' — вход ещё не подключён'}
                onClick={() => { haptic('light'); startProvider(p.id) }}
              >
                <span className={`auth-prov-dot is-${p.id}`} aria-hidden="true" />
                {p.title}
                {p.on ? null : <span className="auth-prov-soon">скоро</span>}
              </button>
            ))}
          </div>
        ) : null}

        <div className="auth-or"><span>или по почте</span></div>

        {/* Кто уже входил с этого устройства — до пяти (потолок сервера). Это не
            «переключение без пароля»: адрес лишь подставляется, пароль спросим. */}
        {seen.length ? (
          <div className="auth-seen">
            {seen.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`auth-seen-chip${email.trim() === a.email ? ' is-on' : ''}`}
                onClick={() => { haptic('light'); setEmail(a.email); setMode('login'); setError('') }}
              >
                {a.name || a.email}
              </button>
            ))}
          </div>
        ) : null}

        <label className="auth-field">
          <AtSign size={16} aria-hidden="true" />
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="Почта"
            aria-label="Почта"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
          />
        </label>

        <label className="auth-field">
          <KeyRound size={16} aria-hidden="true" />
          <input
            type={show ? 'text' : 'password'}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder={mode === 'login' ? 'Пароль' : 'Пароль (от 8 знаков)'}
            aria-label="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
          />
          <button
            type="button"
            className="auth-eye"
            aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}
            onClick={() => setShow((v) => !v)}
          >
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </label>

        {error ? <div className="auth-error">{error}</div> : null}
        {done ? <div className="auth-done"><CheckCircle2 size={15} /> {done}</div> : null}

        <Button variant="primary" onClick={() => void submit()} disabled={busy === 'submit' || !живой}>
          {busy === 'submit' ? <Loader2 size={15} className="rep-spin" /> : <LogIn size={15} />}
          {mode === 'login' ? 'Войти' : 'Создать аккаунт'}
        </Button>

        <div className="auth-foot">
          <button
            type="button"
            className="auth-link"
            onClick={() => void recover()}
            disabled={busy === 'recover' || !mail}
            title={mail ? 'Пришлём новый пароль на почту' : 'Почта ещё не подключена владельцем'}
          >
            {busy === 'recover' ? <Loader2 size={13} className="rep-spin" /> : null}
            Забыли пароль?
          </button>
          {mail ? null : <span className="auth-hint">Восстановление включится, когда владелец подключит почту.</span>}
        </div>

        <div className="auth-note">
          С одного устройства — не больше пяти аккаунтов. Входы через сети подключаются по мере ключей;
          включённые сейчас видны выше.
        </div>
      </div>
    </div>
  )
}
