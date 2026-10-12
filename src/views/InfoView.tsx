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
import { ChevronRight, Cpu, Info, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, IconButton } from '../components/ui'
import { fetchCounters } from '../lib/api'
import { APP_VERSION, forceAppUpdate } from '../lib/version'
import type { ViewId } from '../App'

interface InfoViewProps {
  notify: (msg: string) => void
  onNavigate: (v: ViewId) => void
}

export function InfoView({ notify, onNavigate }: InfoViewProps) {
  const [models, setModels] = useState('считаю…')
  /* 0.174: служебного входа по коду здесь больше нет — владелец сказал «без
     всякого кода». Он входит обычным аккаунтом, и «Обращения» появляются в
     профиле сами: сервер знает, чей это аккаунт (engine/accounts.js). */

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
        <div className="rows-row">
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
