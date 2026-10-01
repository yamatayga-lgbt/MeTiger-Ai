import {
  Bell,
  Info,
  Monitor,
  Moon,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Volume2,
} from 'lucide-react'
import { Badge, Segmented, Switch } from '../components/ui'
import { usePersistentState } from '../hooks/usePersistentState'
import { displayName, initials, type TgUser } from '../lib/telegram'
import { APP_VERSION } from '../lib/version'
import type { ThemePref } from '../hooks/useTheme'

interface SettingsViewProps {
  user: TgUser
  themePref: ThemePref
  onThemePref: (p: ThemePref) => void
  isTelegram: boolean
  notify: (msg: string) => void
}

export function SettingsView({
  user,
  themePref,
  onThemePref,
  isTelegram,
  notify,
}: SettingsViewProps) {
  const [prefs, setPrefs] = usePersistentState('mt-settings', {
    notifications: true,
    sounds: false,
  })

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
          {user.photo_url ? <img src={user.photo_url} alt="" /> : initials(user)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="name">{displayName(user)}</div>
          <div className="handle">
            {user.username ? `@${user.username}` : 'Гость'} ·{' '}
            {isTelegram ? 'Telegram подключён' : 'Демо-режим'}
          </div>
        </div>
        <Badge tone={isTelegram ? 'green' : 'amber'}>
          <span className="dot" />
          {isTelegram ? 'Online' : 'Preview'}
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
              <Info size={16} />
            </div>
            <div className="grow">
              <div className="n">Версия</div>
              <div className="d">MeTiger Ai · дизайн-превью</div>
            </div>
            <Badge tone="gray">{APP_VERSION}</Badge>
          </div>
        </div>
      </div>

      <div className="app-foot">
        MeTiger Ai © 2026
        <br />
        Универсальный ИИ-агент в Telegram
      </div>
    </div>
  )
}
