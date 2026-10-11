/**
 * Профиль — экран, который открывается по аватарке в нижней панели (0.155).
 *
 * Список повторяет приложение ChatGPT, но без того, что у нас нечего показать
 * (владелец вычеркнул это красным: «Плагины», «Изменить план», «Родительский
 * контроль», «Возраст»). Всё, что пока не работает, помечено честным «Скоро» —
 * кнопка не притворяется живой, а человек сразу видит, что за ней пока ничего нет.
 *
 * Профиль — единственный вход в настройки: отдельного пункта «Настройки» в меню
 * больше нет по просьбе владельца.
 */
import {
  BarChart3,
  Briefcase,
  ChevronRight,
  Mail,
  Map,
  Pencil,
  Settings,
  Smile,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '../components/ui'
import { haptic } from '../lib/haptic'

import { displayName, initials, type Person } from '../lib/user'
import type { ViewId } from '../App'

interface ProfileViewProps {
  user: Person
  notify: (msg: string) => void
  onNavigate: (v: ViewId) => void
}

/** Строка списка: иконка, подпись, справа — значение, «Скоро» или шеврон. */
function Row({
  icon,
  label,
  value,
  soon,
  chevron,
  onClick,
}: {
  icon: ReactNode
  label: string
  value?: string
  soon?: boolean
  chevron?: boolean
  onClick?: () => void
}) {
  const body = (
    <>
      <span className="rows-ic" aria-hidden="true">
        {icon}
      </span>
      <span className="rows-name">{label}</span>
      {value ? <span className="rows-val">{value}</span> : null}
      {soon ? <Badge tone="gray">Скоро</Badge> : null}
      {chevron ? (
        <ChevronRight size={17} className="rows-chev" aria-hidden="true" />
      ) : null}
    </>
  )
  if (!onClick) {
    return <div className={`rows-row${soon ? ' is-soon' : ''}`}>{body}</div>
  }
  return (
    <button
      type="button"
      className="rows-row tappable"
      onClick={() => {
        haptic('light')
        onClick()
      }}
    >
      {body}
    </button>
  )
}

export function ProfileView({ user, notify, onNavigate }: ProfileViewProps) {
  const name = displayName(user)
  const soon = (what: string) => () => notify(what + ' — скоро')

  return (
    <div className="container view profile-view">
      <div className="profile-hero">
        <div className="profile-ava-wrap">
          <div className="profile-ava">{initials(user)}</div>
          <button
            type="button"
            className="profile-ava-edit"
            aria-label="Сменить фото профиля"
            onClick={() => {
              haptic('light')
              notify('Фото профиля — скоро')
            }}
          >
            <Pencil size={14} />
          </button>
        </div>
        <div className="profile-name">{name}</div>
      </div>

      <div className="rows-label">Мой MeTiger</div>
      <div className="rows-card">
        <Row
          icon={<Smile size={20} />}
          label="Персонализация"
          chevron
          onClick={() => onNavigate('personalization')}
        />
        <Row icon={<Map size={20} />} label="Память" soon onClick={soon('Память')} />
      </div>

      <div className="rows-label">Учетная запись</div>
      <div className="rows-card">
        <Row
          icon={<Briefcase size={20} />}
          label="Рабочая область"
          value="Личное"
          soon
          onClick={soon('Рабочая область')}
        />
        <Row
          icon={<BarChart3 size={20} />}
          label="Использование и лимиты"
          chevron
          onClick={() => onNavigate('usage')}
        />
        <Row
          icon={<Mail size={20} />}
          label="Электронная почта"
          value="не указана"
          soon
          onClick={soon('Почта')}
        />
      </div>

      <div className="rows-label">Приложение</div>
      <div className="rows-card">
        <Row
          icon={<Settings size={20} />}
          label="Настройки"
          chevron
          onClick={() => onNavigate('settings')}
        />
      </div>

      <div className="app-foot">
        MeTiger Ai © 2026
        <br />
        Универсальный ИИ-агент: тексты, код, картинки, файлы
      </div>
    </div>
  )
}
