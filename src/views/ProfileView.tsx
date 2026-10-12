/**
 * Профиль — экран, который открывается строкой с аватаркой в меню (0.155).
 *
 * С 0.159 профиль — ЭТО И ЕСТЬ настройки: владелец попросил убрать отдельную
 * вкладку настроек и перенести сюда все четыре её компонента («Профиль и будет
 * читаться как Настройки»). Поэтому ниже карточек про человека идут строки
 * настройки приложения: «Внешний вид» (раскрывается — светлая/тёмная/системная),
 * «Управление данными», «Сообщить об ошибке», «Информация».
 *
 * 0.173: «Рабочая область» убрана (просьба владельца), «Сообщить об ошибке»
 * открывает живую форму, а у владельца — который один раз ввёл код в «Информации» —
 * добавляется карточка «Ведомство» со строкой «Обращения» и счётчиком новых.
 *
 * Список повторяет приложение ChatGPT, но без того, что у нас нечего показать
 * (владелец вычеркнул это красным: «Плагины», «Изменить план», «Родительский
 * контроль», «Возраст»). Всё, что пока не работает, помечено честным «Скоро» —
 * кнопка не притворяется живой, а человек сразу видит, что за ней пока ничего нет.
 */
import {
  AtSign,
  BarChart3,
  Bug,
  ChevronDown,
  Inbox,
  ChevronRight,
  Database,
  Info,
  Map,
  Monitor,
  Moon,
  Pencil,
  Smile,
  Sun,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Badge, Button, Segmented } from '../components/ui'
import { ReportSheet } from '../components/ReportSheet'
import { loadReports, ownerEnabled } from '../lib/report'
import { claimId, idProblemLocal, idShown, myId, waitText, type MyDevice } from '../lib/devid'
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
  /* 0.176: ID устройства и его карточка — «вместо профилей будет ID:Аккаунтов». */
  device?: MyDevice | null
  onDevice?: (d: MyDevice | null) => void
  /** Владелец определяется кодом на устройстве; у него же ID #Dev и «Админ». */
  owner?: boolean
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

export function ProfileView({ user, notify, onNavigate, themePref, onThemePref, device = null, onDevice, owner: ownerProp = false }: ProfileViewProps) {
  const name = displayName(user)
  const soon = (what: string) => () => notify(what + ' — скоро')
  /* «Внешний вид» — раскрывающаяся строка: тема выбирается прямо под подписью,
     как в приложении ChatGPT. Свёрнута по умолчанию, чтобы список оставался списком. */
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  /* 0.173: живая форма «Сообщить об ошибке» и — только у владельца — счётчик
     новых обращений. Счётчик читаем при открытии профиля: владелец должен видеть
     «есть новое» сразу, а не после захода в сам список. */
  const [reportOpen, setReportOpen] = useState(false)
  const [owner, setOwner] = useState(() => ownerEnabled())
  const [freshReports, setFreshReports] = useState(0)
  /* 0.176: строка «Мой ID» — раскрывается в поле. Значение берём из карточки
     устройства (её приносит сервер), а не из localStorage: сервер — хозяин ID. */
  const [idOpen, setIdOpen] = useState(false)
  const [idDraft, setIdDraft] = useState('')
  const [idNote, setIdNote] = useState('')
  const [idBusy, setIdBusy] = useState(false)
  const myIdValue = device?.id || myId()

  useEffect(() => {
    if (ownerProp) setOwner(true)
  }, [ownerProp])

  /* Сохранение ID: окончательное слово за сервером — он один знает, занят ли ID,
     служебное ли имя и прошла ли неделя с прошлой смены. */
  const saveIdNow = async () => {
    if (idBusy) return
    setIdBusy(true)
    setIdNote('')
    const r = await claimId(idDraft.trim())
    setIdBusy(false)
    if (!r.ok) {
      setIdNote(String(r.error || 'не получилось — попробуйте ещё раз'))
      return
    }
    if (r.device) onDevice?.(r.device)
    setIdNote(r.note ? String(r.note) : 'сохранено: ' + idShown(r.device?.id || idDraft.trim()))
    notify('Ваш ID: ' + idShown(r.device?.id || idDraft.trim()))
  }

  useEffect(() => {
    if (!ownerEnabled()) return
    let alive = true
    void loadReports().then((r) => {
      if (!alive) return
      if (r.ok) setOwner(true)
      setFreshReports(r.fresh)
    })
    return () => { alive = false }
  }, [])

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

      {/* «Рабочая область» убрана по просьбе владельца (0.173). Остальные строки
          раздела на месте: «Использование и лимиты» — расход, «Электронная
          почта» — заготовка входа по адресу. */}
      <div className="rows-label">Учетная запись</div>
      <div className="rows-card">
        <Row
          icon={<BarChart3 size={20} />}
          label="Использование и лимиты"
          chevron
          onClick={() => onNavigate('usage')}
        />
        {/* 0.176: вместо профилей — ID, который человек выбирает сам («При новом
            пользователе с устройства он сам будет вызначать себе айди»). Срок
            смены считает сервер; здесь только поле и слова. */}
        <button
          type="button"
          className="rows-row tappable"
          aria-label="Мой ID"
          onClick={() => {
            haptic('light')
            setIdOpen((v) => !v)
            setIdNote('')
            setIdDraft(myIdValue)
          }}
        >
          <span className="rows-ic" aria-hidden="true">
            <AtSign size={20} />
          </span>
          <span className="rows-name">Мой ID</span>
          <span className="rows-val">{myIdValue ? idShown(myIdValue) : 'не задан'}</span>
          {device?.locked ? <Badge tone="blue">закреплён</Badge> : null}
          <ChevronDown size={17} className={`rows-chev${idOpen ? ' is-open' : ''}`} aria-hidden="true" />
        </button>
        {idOpen ? (
          <div className="rows-row is-plain acc-box">
            <div className="rows-hint">
              {device?.locked
                ? 'Это ID владельца — он закреплён за этим устройством и не меняется.'
                : device?.renameInDays
                  ? `Следующая смена — ${waitText(device.renameInDays)}: менять можно раз в неделю.`
                  : 'Только латинские буквы, от 4 до 15. Менять можно раз в неделю.'}
              {device?.model ? ` Телефон: ${device.model}.` : ''}
            </div>
            <div className={`idc-field${idDraft && idProblemLocal(idDraft) ? ' is-bad' : ''}`}>
              <input
                type="text"
                inputMode="text"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Ваш ID — только буквы"
                aria-label="Ваш ID"
                value={idDraft}
                disabled={!!device?.locked}
                onChange={(e) => {
                  setIdDraft(e.target.value.replace(/[^A-Za-z]/g, ''))
                  setIdNote('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !device?.locked) void saveIdNow()
                }}
              />
            </div>
            <div className="rows-hint">
              {device?.locked
                ? 'ID владельца неизменен.'
                : idProblemLocal(idDraft) || (idDraft && idDraft === myIdValue ? 'это ваш нынешний ID' : '')}
            </div>
            {idNote ? <div className="rows-hint">{idNote}</div> : null}
            {device?.locked ? null : (
              <div className="acc-out">
                <Button
                  variant="primary"
                  disabled={
                    idBusy ||
                    !idDraft.trim() ||
                    !!idProblemLocal(idDraft) ||
                    idDraft.trim() === myIdValue
                  }
                  onClick={() => void saveIdNow()}
                >
                  {idBusy ? 'Сохраняю…' : myIdValue ? 'Сменить ID' : 'Сохранить ID'}
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Настройки приложения — прямо здесь, а не на отдельном экране: владелец
          попросил убрать вкладку настроек и перенести эти четыре строки в профиль. */}
      {owner ? (
        <>
          {/* «Обращения» отдельной строкой здесь больше нет: владелец попросил не
              делать вторую дверь (12 окт) — они живут вкладкой в админ-панели,
              а сюда вынесен только счётчик новых и вход в саму панель. */}
          <div className="rows-label">Разработчик</div>
          <div className="rows-card">
            <Row
              icon={<Inbox size={20} />}
              label="Админ-панель"
              /* Хвост короткий: с длинным «устройства и обращения» подпись
                 обрезалась в «Админ-пан…» — на телефоне это выглядело поломкой. */
              value="устройства"
              chevron
              onClick={() => {
                haptic('light')
                onNavigate('admin')
              }}
            />
            {freshReports > 0 ? (
              <div className="rows-row is-plain">
                <span className="rows-hint">
                  {freshReports > 0
                    ? `Новых обращений: ${freshReports} — они во вкладке «Админ-панель». Это окно видят только устройства с кодом владельца.`
                    : 'Обращений нет. Это окно видят только устройства с кодом владельца.'}
                </span>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

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
        {/* 0.173: форма ожила — «Скоро» снято. Описали проблему, приложили до
            четырёх снимков, отправили владельцу. */}
        <button
          type="button"
          className="rows-row tappable"
          aria-label="Сообщить об ошибке"
          onClick={() => {
            haptic('light')
            setReportOpen(true)
          }}
        >
          <span className="rows-ic" aria-hidden="true">
            <Bug size={20} />
          </span>
          <span className="rows-name">Сообщить об ошибке</span>
        </button>
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

      {reportOpen ? <ReportSheet onClose={() => setReportOpen(false)} /> : null}

      <div className="app-foot">
        MeTiger Ai © 2026
        <br />
        Универсальный ИИ-агент: тексты, код, картинки, файлы
      </div>
    </div>
  )
}
