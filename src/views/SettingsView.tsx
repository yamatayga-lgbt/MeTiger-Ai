import {
  Bell,
  Globe,
  Info,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  Volume2,
} from 'lucide-react'
import { Badge, Segmented, Switch } from '../components/ui'
import { displayName, initials, type TgUser } from '../lib/telegram'
import type { ThemePref } from '../hooks/useTheme'
import { useState } from 'react'

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
  const [notifications, setNotifications] = useState(true)
  const [sounds, setSounds] = useState(false)

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
              <div className="d">Следовать системе или выбрать свою</div>
            </div>
            <Segmented
              value={themePref}
              onChange={onThemePref}
              options={[
                { value: 'system', label: 'Авто' },
                { value: 'light', label: 'Светлая' },
                { value: 'dark', label: 'Тёмная' },
              ]}
            />
          </div>
          <div className="settings-row">
            <div className="icon-wrap">
              <Globe size={16} />
            </div>
            <div className="grow">
              <div className="n">Язык</div>
              <div className="d">Язык интерфейса</div>
            </div>
            <Segmented
              value="ru"
              onChange={() => notify('English — скоро')}
              options={[
                { value: 'ru', label: 'Русский' },
                { value: 'en', label: 'English', disabled: true },
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
              checked={notifications}
              label="Уведомления"
              onChange={setNotifications}
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
            <Switch checked={sounds} label="Звуки" onChange={setSounds} />
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
            <Badge tone="gray">v0.1.0</Badge>
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
