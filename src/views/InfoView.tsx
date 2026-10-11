/**
 * Информация (0.155) — версия, обновление, модели и «что нового».
 *
 * Сюда переехало то, что раньше лежало в самом низу настроек («Приложение»):
 * строка версии с кнопкой обновления, число доступных моделей с их перечитыванием
 * и вход в «Что нового». Отдельным экраном — потому что в списке настроек это
 * одна строка «Информация», как в приложении ChatGPT.
 */
import { Cpu, Info, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button } from '../components/ui'
import { fetchCounters } from '../lib/api'
import { APP_VERSION, forceAppUpdate } from '../lib/version'
import type { ViewId } from '../App'

interface InfoViewProps {
  notify: (msg: string) => void
  onNavigate: (v: ViewId) => void
}

export function InfoView({ notify, onNavigate }: InfoViewProps) {
  const [models, setModels] = useState('считаю…')

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

      <div className="settings-group">
        <div className="settings-label">Приложение</div>
        <div className="settings-card">
          <div className="settings-row">
            <div className="icon-wrap">
              <Info size={16} />
            </div>
            {/* Короткая строка (просьба владельца из 0.113): только номер и
                кнопка — без длинного пояснения под названием. */}
            <div className="grow">
              <div className="n">Версия</div>
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
          <div
            className="settings-row tappable"
            role="button"
            tabIndex={0}
            onClick={() => onNavigate('whatsnew')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onNavigate('whatsnew')
              }
            }}
          >
            <div className="icon-wrap">
              <Sparkles size={16} />
            </div>
            <div className="grow">
              <div className="n">Что нового</div>
              <div className="d">Что изменилось в текущей версии</div>
            </div>
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
