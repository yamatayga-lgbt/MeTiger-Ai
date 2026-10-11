/**
 * Профиль — экран, который открывается строкой с аватаркой в меню (0.155).
 *
 * С 0.159 профиль — ЭТО И ЕСТЬ настройки: владелец попросил убрать отдельную
 * вкладку настроек и перенести сюда все четыре её компонента («Профиль и будет
 * читаться как Настройки»). Поэтому ниже карточек про человека идут строки
 * настройки приложения: «Внешний вид» (раскрывается — светлая/тёмная/системная),
 * «Управление данными», «Сообщить об ошибке», «Информация».
 *
 * Список повторяет приложение ChatGPT, но без того, что у нас нечего показать
 * (владелец вычеркнул это красным: «Плагины», «Изменить план», «Родительский
 * контроль», «Возраст»). Всё, что пока не работает, помечено честным «Скоро» —
 * кнопка не притворяется живой, а человек сразу видит, что за ней пока ничего нет.
 */
import {
  BarChart3,
  Briefcase,
  Bug,
  ChevronDown,
  ChevronRight,
  Database,
  Info,
  Mail,
  Map,
  Monitor,
  Moon,
  Pencil,
  Smile,
  Sun,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Badge, Segmented } from '../components/ui'
import { haptic } from '../lib/haptic'
import type { ThemePref } from '../hooks/useTheme'

import { displayName, initials, type Person } from '../lib/user'
import type { ViewId } from '../App'

interface ProfileViewProps {
  user: Person
  notify: (msg: string) => void
  onNavigate: (v: ViewId) => void
  /* Настройки приложения живут здесь же (0.159): тема и есть то, ради чего
     раньше открывали отдельный экран настроек. */
  themePref: ThemePref
  onThemePref: (p: ThemePref) => void
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

export function ProfileView({ user, notify, onNavigate, themePref, onThemePref }: ProfileViewProps) {
  const name = displayName(user)
  const soon = (what: string) => () => notify(what + ' — скоро')
  /* «Внешний вид» — раскрывающаяся строка: тема выбирается прямо под подписью,
     как в приложении ChatGPT. Свёрнута по умолчанию, чтобы список оставался списком. */
  const [appearanceOpen, setAppearanceOpen] = useState(false)

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

      {/* Настройки приложения — прямо здесь, а не на отдельном экране: владелец
          попросил убрать вкладку настроек и перенести эти четыре строки в профиль. */}
      <div className="rows-label">Приложение</div>
      <div className="rows-card">
        <button
          type="button"
          className="rows-row tappable"
          aria-expanded={appearanceOpen}
          onClick={() => {
            haptic('light')
            setAppearanceOpen((v) => !v)
          }}
        >
          <span className="rows-ic" aria-hidden="true">
            <Sun size={20} />
          </span>
          <span className="rows-name">Внешний вид</span>
          <ChevronDown
            size={17}
            className={`rows-chev${appearanceOpen ? ' is-open' : ''}`}
            aria-hidden="true"
          />
        </button>
        {appearanceOpen ? (
          <div className="rows-row is-plain">
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
            <span className="rows-hint">Тема приложения</span>
          </div>
        ) : null}

        <button
          type="button"
          className="rows-row tappable"
          onClick={() => {
            haptic('light')
            onNavigate('data')
          }}
        >
          <span className="rows-ic" aria-hidden="true">
            <Database size={20} />
          </span>
          <span className="rows-name">Управление данными</span>
        </button>
        <div className="rows-row is-soon">
          <span className="rows-ic" aria-hidden="true">
            <Bug size={20} />
          </span>
          <span className="rows-name">Сообщить об ошибке</span>
          <Badge tone="gray">Скоро</Badge>
        </div>
        <button
          type="button"
          className="rows-row tappable"
          onClick={() => {
            haptic('light')
            onNavigate('info')
          }}
        >
          <span className="rows-ic" aria-hidden="true">
            <Info size={20} />
          </span>
          <span className="rows-name">Информация</span>
        </button>
      </div>

      <div className="app-foot">
        MeTiger Ai © 2026
        <br />
        Универсальный ИИ-агент: тексты, код, картинки, файлы
      </div>
    </div>
  )
}
