import {
  Bell,
  Cpu,
  Fingerprint,
  Info,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  UserRound,
  Volume2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Segmented, Switch } from '../components/ui'
import {
  clearProfile,
  fetchCounters,
  fetchProfile,
  profileStatusLine,
  saveProfile,
  signalsLine,
  type ProfileFields,
} from '../lib/api'
import { currentUserId, identityLine } from '../lib/identity'
import { GENDER_CHOICES, isGender, type Gender } from '../lib/gender'
import { usePersistentState } from '../hooks/usePersistentState'
import { displayName, initials, savePersonName, type Person } from '../lib/user'
import { APP_VERSION, forceAppUpdate } from '../lib/version'
import type { ThemePref } from '../hooks/useTheme'

interface SettingsViewProps {
  user: Person
  themePref: ThemePref
  onThemePref: (p: ThemePref) => void
  notify: (msg: string) => void
}

export function SettingsView({
  user,
  themePref,
  onThemePref,
  notify,
}: SettingsViewProps) {
  const [prefs, setPrefs] = usePersistentState('mt-settings', {
    notifications: true,
    sounds: false,
  })

  /* Род агента лежит отдельным ключом, а не внутри mt-settings: его читает отправка
     сообщения в App.tsx, и эти два места не должны затырать друг друга. */
  const [gender, setGender] = usePersistentState<Gender>('mt-gender', 'auto', isGender)

  /* Профиль — три поля о человеке, которые уходят в каждый ответ. Они живут НЕ в
     localStorage: иначе «память» зависела бы от браузера и не доезжала бы до бота.
     Здесь только форма и статус; настоящее хранит KV на сервере. */
  const [prof, setProf] = useState<ProfileFields>({ name: '', job: '', about: '' })
  const [profStatus, setProfStatus] = useState('читаю…')
  const [profSignals, setProfSignals] = useState('')
  const [busy, setBusy] = useState(false)
  const [models, setModels] = useState('считаю…')

  const loadProfile = useCallback(async () => {
    const r = await fetchProfile()
    if (r.ok && r.profile) {
      setProf({ name: r.profile.name || '', job: r.profile.job || '', about: r.profile.about || '' })
      setProfStatus(profileStatusLine(r))
      setProfSignals(signalsLine(r))
    } else {
      setProfStatus(r.error || 'профиль не прочитан')
    }
  }, [])

  useEffect(() => {
    void loadProfile()
    void refreshModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshModels() {
    setModels('обновляю…')
    const r = await fetchCounters()
    setModels(r.line)
  }

  async function onSave() {
    setBusy(true)
    const r = await saveProfile(prof)
    if (r.ok) {
      setProfStatus(r.unchanged ? 'ничего не изменилось — сохранилось как было' : profileStatusLine(r))
      setProfSignals(signalsLine(r))
      /* Имя нужно не только этому экрану: с ним приветствие в чате и сидбар
         называют человека, а не «Гость». Пишем рядом с серверной копией. */
      savePersonName(prof.name)
      notify(r.unchanged ? 'Менять нечего' : 'Записал: учту в следующих ответах')
    } else {
      /* сохрание прилетело отказом — человек должен видеть причину, а не крутящийся
         спиннер: слишком часто, нет KV, нет сети — это разные истории */
      setProfStatus('Не сохранил: ' + (r.error || 'неизвестно'))
      notify('Профиль не сохранён')
    }
    setBusy(false)
  }

  async function onClear() {
    setBusy(true)
    const r = await clearProfile()
    if (r.ok) {
      setProf({ name: '', job: '', about: '' })
      setProfStatus('профиль забыт · поля пустые')
      setProfSignals('')
      notify('Профиль очищен')
    } else {
      setProfStatus('Не очистил: ' + (r.error || 'неизвестно'))
    }
    setBusy(false)
  }

  return (
    <div className="container view">
      <div className="page-head">
        <div className="grow">
          <h1>Настройки</h1>
          <p className="sub">Внешний вид, ассистент и параметры приложения.</p>
        </div>
        <SlidersHorizontal
          size={22}
          color="var(--text-3)"
          style={{ marginTop: 4, flexShrink: 0 }}
        />
      </div>

      <div className="profile-card">
        <div className="avatar" style={{ width: 54, height: 54, fontSize: 18 }}>
          {initials(user)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="name">{displayName(user)}</div>
          <div className="handle">
            {user.handle}
          </div>
        </div>
        <Badge tone="gray">
          <span className="dot" />
          без аккаунта
        </Badge>
      </div>

      <div className="settings-group" style={{ marginTop: 26 }}>
        <div className="settings-label">Внешний вид</div>
        <div className="settings-card">
          <div className="settings-row">
            <div className="icon-wrap">
              <Palette size={16} />
            </div>
            <div className="grow">
              <div className="n">Тема</div>
            </div>
            <Segmented
              variant="icon"
              value={themePref}
              onChange={onThemePref}
              options={[
                { value: 'system', label: <Monitor size={15} />, title: 'Системная' },
                { value: 'light', label: <Sun size={15} />, title: 'Светлая' },
                { value: 'dark', label: <Moon size={15} />, title: 'Тёмная' },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-label">Ассистент</div>
        <div className="settings-card">
          <div className="settings-row">
            <div className="icon-wrap">
              <Bell size={16} />
            </div>
            <div className="grow">
              <div className="n">Уведомления</div>
              <div className="d">Ответы агента и статусы задач</div>
            </div>
            <Switch
              checked={prefs.notifications}
              label="Уведомления"
              onChange={(v) => setPrefs({ ...prefs, notifications: v })}
            />
          </div>
          <div className="settings-row">
            <div className="icon-wrap">
              <Volume2 size={16} />
            </div>
            <div className="grow">
              <div className="n">Звуки</div>
              <div className="d">Звук при ответе агента</div>
            </div>
            <Switch
              checked={prefs.sounds}
              label="Звуки"
              onChange={(v) => setPrefs({ ...prefs, sounds: v })}
            />
          </div>
          <div className="settings-row">
            <div className="icon-wrap">
              <UserRound size={16} />
            </div>
            <div className="grow">
              <div className="n">Род агента</div>
            </div>
            <Segmented
              value={gender}
              onChange={setGender}
              options={GENDER_CHOICES.map((c) => ({ value: c.value, label: c.title, title: c.hint }))}
            />
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-label">Память</div>
        <div className="settings-card">
          <div className="settings-row">
            <div className="icon-wrap">
              <Fingerprint size={16} />
            </div>
            <div className="grow">
              <div className="n">Чья это память</div>
              <div className="d">
                {identityLine(currentUserId())} — у каждого человека своя, память
                необщая. Сменить ключ = начать с чистого листа
              </div>
            </div>
            <Badge tone="gray">Браузер</Badge>
          </div>
          <div className="settings-form">
            <label>
              <span>Как вас зовут</span>
              <input
                value={prof.name}
                maxLength={60}
                placeholder="Например, Иван"
                onChange={(e) => setProf({ ...prof, name: e.target.value })}
              />
            </label>
            <label>
              <span>Ваша профессия или занятие</span>
              <input
                value={prof.job}
                maxLength={90}
                placeholder="Например, аналитик данных"
                onChange={(e) => setProf({ ...prof, job: e.target.value })}
              />
            </label>
            <label>
              <span>Подробнее о вас</span>
              <textarea
                value={prof.about}
                maxLength={1500}
                rows={4}
                placeholder="Интересы и предпочтения: что учитывать, отвечать коротко или подробно, нужны ли примеры и код"
                onChange={(e) => setProf({ ...prof, about: e.target.value })}
              />
              <span className="hint">
                Три поля уходят агенту в каждый ответ. Он опирается на них и не
                выдумывает сверх написанного; в разговоре их не пересказывает.
              </span>
            </label>
            <div className="actions">
              <Button variant="primary" icon={Save} onClick={onSave} disabled={busy}>
                Сохранить
              </Button>
              <Button variant="ghost" icon={Trash2} onClick={onClear} disabled={busy}>
                Забыть
              </Button>
              <span className="hint">{profStatus}</span>
            </div>
            {profSignals ? <div className="settings-signals">{profSignals}</div> : null}
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-label">Приложение</div>
        <div className="settings-card">
          <div
            className="settings-row tappable"
            role="button"
            tabIndex={0}
            onClick={() => notify('Панель администратора — в следующих версиях')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                notify('Панель администратора — в следующих версиях')
              }
            }}
          >
            <div className="icon-wrap">
              <ShieldCheck size={16} />
            </div>
            <div className="grow">
              <div className="n">Панель управления</div>
              <div className="d">Админка SaaS: пользователи, лимиты, статистика</div>
            </div>
            <Badge tone="blue">Скоро</Badge>
          </div>
          <div className="settings-row">
            <div className="icon-wrap">
              <Cpu size={16} />
            </div>
            <div className="grow">
              <div className="n">Модели</div>
              <div className="d">{models}</div>
            </div>
            <Button variant="ghost" icon={RefreshCw} onClick={refreshModels}>
              Обновить
            </Button>
          </div>
          <div className="settings-row">
            <div className="icon-wrap">
              <Info size={16} />
            </div>
            <div className="grow">
              <div className="n">Версия</div>
              <div className="d">MeTiger Ai · показывает старую версию? нажмите «Обновить»</div>
            </div>
            <Badge tone="gray">{APP_VERSION}</Badge>
            <Button
              variant="ghost"
              icon={RefreshCw}
              onClick={() => {
                notify('Обновляю приложение…')
                void forceAppUpdate()
              }}
            >
              Обновить
            </Button>
          </div>
        </div>
      </div>

      <div className="app-foot">
        MeTiger Ai © 2026
        <br />
        Универсальный ИИ-агент: тексты, код, картинки, файлы
      </div>
    </div>
  )
}
