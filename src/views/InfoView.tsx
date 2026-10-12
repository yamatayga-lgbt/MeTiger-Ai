/**
 * Информация (0.155) — версия, обновление, модели и «что нового».
 *
 * Сюда переехало то, что раньше лежало в самом низу настроек («Приложение»):
 * строка версии с кнопкой обновления, число доступных моделей с их перечитыванием
 * и вход в «Что нового». Отдельным экраном — потому что в списке настроек это
 * одна строка «Информация», как в приложении ChatGPT.
 *
 * Строки — того же вида, что и в профиле/настройках (.rows-row): иконка, подпись,
 * значение справа, кнопка или шеврон. Экран читается как список, а не как форма.
 */
import { ChevronRight, Cpu, Info, Loader2, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge, Button, IconButton } from '../components/ui'
import { fetchCounters } from '../lib/api'
import { APP_VERSION, forceAppUpdate } from '../lib/version'
import { announceOwnerChange } from '../lib/devid'
import { checkOwnerCode, ownerEnabled, setOwnerCode } from '../lib/report'
import { haptic } from '../lib/haptic'
import type { ViewId } from '../App'

interface InfoViewProps {
  notify: (msg: string) => void
  onNavigate: (v: ViewId) => void
}

/* Сколько тапов по строке версии открывают служебный вход и за какое время.
   Пять быстрых касаний — как «режим разработчика» в Android: владелец знает, куда
   нажать, случайный человек не откроет это, листая настройки. */
const OWNER_TAPS = 5
const OWNER_TAPS_MS = 3000

export function InfoView({ notify, onNavigate }: InfoViewProps) {
  const [models, setModels] = useState('считаю…')
  /* Служебный вход (0.173): пять тапов по версии → поле для кода владельца.
     Открыт ли вход — живёт только в этом заходе на экран: приложение не должно
     держать открытой «дверь» с прошлого раза. */
  const [ownerOpen, setOwnerOpen] = useState(false)
  const [ownerOn, setOwnerOn] = useState(() => ownerEnabled())
  const [code, setCode] = useState('')
  const [ownerBusy, setOwnerBusy] = useState(false)
  const taps = useRef<number[]>([])

  const tapVersion = () => {
    const now = Date.now()
    taps.current = taps.current.filter((t) => now - t < OWNER_TAPS_MS).concat(now)
    if (taps.current.length >= OWNER_TAPS) {
      taps.current = []
      haptic('medium')
      setOwnerOpen(true)
    }
  }

  async function refreshModels() {
    setModels('обновляю…')
    const r = await fetchCounters()
    setModels(r.line)
  }

  /* Счётчик показывается сразу при открытии экрана: человек не должен нажимать
     «Обновить», чтобы увидеть число, которое и так можно узнать. */
  useEffect(() => {
    void refreshModels()
  }, [])

  const applyCode = async () => {
    const v = code.trim()
    if (!v) return
    setOwnerBusy(true)
    const ok = await checkOwnerCode(v)
    setOwnerBusy(false)
    if (ok) {
      setOwnerCode(v)
      setOwnerOn(true)
      setCode('')
      /* Одно событие — и ID #Dev, и пункт «Админ» встают на место сразу: ждать
         следующего запуска после ввода кода было бы похоже на «не сработало». */
      announceOwnerChange()
      notify('Ведомство включено: «Обращения» появились в профиле')
    } else {
      notify('Код не подошёл — проверьте и попробуйте ещё раз')
    }
  }

  const dropCode = () => {
    setOwnerCode('')
    setOwnerOn(false)
    setOwnerOpen(false)
    announceOwnerChange()
    notify('Ведомство выключено на этом устройстве')
  }

  return (
    <div className="container view info-view">
      <div className="page-head">
        <div className="grow">
          <h1>Информация</h1>
          <p className="sub">Версия приложения, модели и список изменений.</p>
        </div>
        <Info size={22} color="var(--text-3)" style={{ marginTop: 4, flexShrink: 0 }} />
      </div>

      <div className="rows-label">Приложение</div>
      <div className="rows-card">
        {/* Короткая строка (просьба владельца из 0.113): только номер и кнопка —
            без длинного пояснения под названием. */}
        <div className="rows-row" onPointerDown={tapVersion}>
          <span className="rows-ic" aria-hidden="true">
            <Info size={20} />
          </span>
          <span className="rows-name">Версия</span>
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

        {ownerOpen ? (
          /* Служебный вход: виден только тому, кто пять раз коснулся версии.
             Поясняем словами, что это и как выключить, — «непонятная дверь» хуже,
             чем её отсутствие. */
          <div className="rows-row is-plain owner-box">
            <div className="owner-title">Служебный вход</div>
            {ownerOn ? (
              <>
                <div className="rows-hint">
                  Ведомство включено на этом устройстве: в профиле есть «Обращения».
                </div>
                <Button variant="ghost" onClick={dropCode}>
                  Выключить
                </Button>
              </>
            ) : (
              <>
                <div className="rows-hint">Введите код владельца — он даёт доступ к обращениям об ошибках.</div>
                <div className="owner-row">
                  <input
                    className="owner-input"
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Код владельца"
                    aria-label="Код владельца"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void applyCode()
                    }}
                  />
                  <Button variant="primary" onClick={() => void applyCode()} disabled={ownerBusy || !code.trim()}>
                    {ownerBusy ? <Loader2 size={14} className="rep-spin" /> : null}
                    Включить
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}

        <button
          type="button"
          className="rows-row tappable"
          onClick={() => onNavigate('whatsnew')}
        >
          <span className="rows-ic" aria-hidden="true">
            <Sparkles size={20} />
          </span>
          <span className="rows-name">Что нового</span>
          <ChevronRight size={17} className="rows-chev" aria-hidden="true" />
        </button>

        {/* Кнопка перечитывания — круглая с иконкой, а не с подписью: на 393px
            подпись «Обновить» выдавливала из строки своё название (замер: у
            «Моделей» оставалось 32px и она обрезалась в «Мод…»). */}
        <div className="rows-row">
          <span className="rows-ic" aria-hidden="true">
            <Cpu size={20} />
          </span>
          <span className="rows-name">Модели</span>
          <span className="rows-val">{models}</span>
          <IconButton icon={RefreshCw} label="Обновить список моделей" onClick={() => void refreshModels()} size={16} />
        </div>

        <div className="rows-row is-soon">
          <span className="rows-ic" aria-hidden="true">
            <ShieldCheck size={20} />
          </span>
          <span className="rows-name">Панель управления</span>
          <Badge tone="blue">Скоро</Badge>
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
