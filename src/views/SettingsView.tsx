/**
 * Настройки (0.155) — список как в приложении ChatGPT, только с нашими пунктами.
 *
 * Владелец вычеркнул красным то, чего у нас нет и не будет по смыслу (Общие,
 * Уведомления, Безопасность и благополучие, Удаленное управление, Центр
 * конфиденциальности, Управление рекламой) — их здесь нет. Осталось то, что есть
 * на скрине, и то, что проекту действительно нужно:
 *
 *   • «Внешний вид» и «Акцентный цвет» — первая карточка, как на скрине;
 *   • Голос, Безопасность и вход, Хранилище, Сообщить об ошибке — пока заглушки,
 *     каждая помечена честным «Скоро»: кнопка не притворяется живой;
 *   • «Управление данными» и «Информация» — рабочие экраны (0.155), в них
 *     переехало всё, что раньше жило строками здесь.
 *
 * Раньше на этом экране были профиль, род агента, уведомления, звуки, тема,
 * модели и версия — профиль и род агента ушли в «Персонализацию» (через профиль),
 * модели и версия — в «Информацию», уведомления и звуки убраны как ненастоящие
 * (они ничего не делали, а владелец их и не просил).
 */
import {
  AudioLines,
  Bug,
  ChevronDown,
  Database,
  HardDrive,
  Info,
  LockKeyhole,
  Monitor,
  Moon,
  Palette,
  Sun,
} from 'lucide-react'
import { useState } from 'react'
import { Badge, Segmented } from '../components/ui'
import { haptic } from '../lib/haptic'
import type { ThemePref } from '../hooks/useTheme'
import type { ViewId } from '../App'

interface SettingsViewProps {
  themePref: ThemePref
  onThemePref: (p: ThemePref) => void
  onNavigate: (v: ViewId) => void
}

export function SettingsView({ themePref, onThemePref, onNavigate }: SettingsViewProps) {
  /* «Внешний вид» — раскрывающаяся строка: тема выбирается прямо под подписью,
     как в приложении ChatGPT. По умолчанию свёрнута, чтобы список оставался списком. */
  const [appearanceOpen, setAppearanceOpen] = useState(false)

  return (
    <div className="container view settings-view">
      <div className="page-head">
        <div className="grow">
          <h1>Настройки</h1>
          <p className="sub">Внешний вид и параметры приложения.</p>
        </div>
      </div>

      <div className="settings-group" style={{ marginTop: 4 }}>
        <div className="settings-card">
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

          <div className="rows-row is-soon">
            <span className="rows-ic" aria-hidden="true">
              <Palette size={20} />
            </span>
            <span className="rows-name">Акцентный цвет</span>
            <span className="rows-dot" aria-hidden="true" />
            <span className="rows-val">Синий</span>
            <Badge tone="gray">Скоро</Badge>
            <ChevronDown size={17} className="rows-chev" aria-hidden="true" />
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-card">
          <div className="rows-row is-soon">
            <span className="rows-ic" aria-hidden="true">
              <AudioLines size={20} />
            </span>
            <span className="rows-name">Голос</span>
            <Badge tone="gray">Скоро</Badge>
          </div>
          <div className="rows-row is-soon">
            <span className="rows-ic" aria-hidden="true">
              <LockKeyhole size={20} />
            </span>
            <span className="rows-name">Безопасность и вход</span>
            <Badge tone="gray">Скоро</Badge>
          </div>
          <div className="rows-row is-soon">
            <span className="rows-ic" aria-hidden="true">
              <HardDrive size={20} />
            </span>
            <span className="rows-name">Хранилище</span>
            <Badge tone="gray">Скоро</Badge>
          </div>
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
      </div>

      <div className="app-foot">
        MeTiger Ai © 2026
        <br />
        Универсальный ИИ-агент: тексты, код, картинки, файлы
      </div>
    </div>
  )
}
