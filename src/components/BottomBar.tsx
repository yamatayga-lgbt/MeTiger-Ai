/**
 * Нижняя панель приложения — как в приложении ChatGPT (0.155).
 *
 * Слева синяя капсула «Чат» — новый разговор. Справа круглая аватарка человека —
 * она же вход в профиль, а через него в настройки. Раньше и то и другое жило в
 * верхней панели и в разделе сайдбара: «Новый чат» стоял подписью капсулы сверху,
 * а в Настройки вела отдельная строка меню. Владелец попросил перенести кнопку
 * вниз и оставить один вход в настройки — через профиль.
 *
 * Панель — обычный блок в колонке .main, а не position: fixed: места внахлёст
 * ни с чем не бывает, и она не «плывёт» над полем ввода в чате.
 */
import { SquarePen } from 'lucide-react'
import { initials, displayName, type Person } from '../lib/user'
import { haptic } from '../lib/haptic'

interface BottomBarProps {
  user: Person
  onNewChat: () => void
  onProfile: () => void
  /** На экране профиля капсула «Чат» остаётся, а аватар отмечается активным. */
  profileActive?: boolean
}

export function BottomBar({ user, onNewChat, onProfile, profileActive = false }: BottomBarProps) {
  const name = displayName(user)
  return (
    <nav className="bottombar" aria-label="Основные действия">
      <button
        type="button"
        className="bottombar-chat"
        onClick={onNewChat}
        title="Начать новый чат"
      >
        <SquarePen size={17} aria-hidden="true" />
        Чат
      </button>

      <button
        type="button"
        className={`bottombar-avatar${profileActive ? ' is-active' : ''}`}
        aria-label={`Профиль: ${name}`}
        title={name}
        onClick={() => {
          haptic('light')
          onProfile()
        }}
      >
        {initials(user)}
      </button>
    </nav>
  )
}
