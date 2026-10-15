/**
 * Персонализация (0.187) — стиль и тон агента, как в приложении ChatGPT.
 *
 * С 0.182 память живёт отдельным экраном, здесь — настройки формы ответа:
 * базовый стиль и тон, дружелюбие, энтузиазм, заголовки и списки, эмодзи.
 * Плюс род агента, который тут с 0.155.
 *
 * Чего в экране больше нет (0.187, по решениям владельца): переключателя
 * быстрых ответов (быстрые модели и так выбираются сами), настройки
 * визуальных ответов (зачёркнута на эскизе) и плашек «сохранено» —
 * переключение и есть сохранение.
 * Раздела с кастомными инструкциями нет с 0.186 — вычеркнут на эскизе.
 */
import { useState } from 'react'
import { Check, Sparkles, UserRound } from 'lucide-react'
import { Segmented } from '../components/ui'
import { PersonaSelect } from '../components/PersonaSelect'
import { GENDER_CHOICES, isGender, type Gender } from '../lib/gender'
import {
  DEFAULT_PERSONA, LEVEL_TITLES, STYLE_CHOICES,
  isPersona,
  type Level, type Persona, type StyleTone,
} from '../lib/persona'
import { usePersistentState } from '../hooks/usePersistentState'

interface PersonalizationViewProps {
  notify: (msg: string) => void
}

const LEVEL_OPTIONS: { value: Level; title: string; sub: string }[] = [
  { value: 'more', title: LEVEL_TITLES.more, sub: '' },
  { value: 'default', title: LEVEL_TITLES.default, sub: 'Как обычно' },
  { value: 'less', title: LEVEL_TITLES.less, sub: '' },
]

/* Пояснения пунктов «Более/Менее» — свои у каждой настройки, как в ChatGPT. */
const LEVEL_SUBS: Record<string, Record<'more' | 'less', string>> = {
  friendliness: { more: 'Более дружелюбный и располагающий', less: 'Более профессиональный и основанный на фактах' },
  enthusiasm: { more: 'Больше энергии и вовлечённости', less: 'Спокойнее и суше' },
  headers: { more: 'Больше заголовков и списков в ответах', less: 'Реже заголовки и списки, больше связного текста' },
  emoji: { more: 'Больше эмодзи', less: 'Меньше эмодзи' },
}

function levelOptions(key: string): { value: Level; title: string; sub: string }[] {
  return LEVEL_OPTIONS.map((o) => ({
    value: o.value,
    title: o.title,
    sub: o.value === 'default' ? o.sub : LEVEL_SUBS[key][o.value],
  }))
}

export function PersonalizationView(_props: PersonalizationViewProps) {
  /* Род агента читает отправка сообщения в App.tsx, поэтому ключ отдельный. */
  const [gender, setGender] = usePersistentState<Gender>('mt-gender', 'auto', isGender)
  /* Персонализация — тем же путём: usePersistentState пишет JSON в mt-persona,
     чтение из отправки (readPersona) понимает тот же формат. */
  const [persona, setPersona] = usePersistentState<Persona>('mt-persona', DEFAULT_PERSONA, isPersona)
  /* Одно открытое меню на экран — как в ChatGPT. */
  const [openName, setOpenName] = useState('')

  function patch(next: Partial<Persona>) {
    setPersona((prev) => ({ ...prev, ...next }))
  }

  const styleLabel = STYLE_CHOICES.find((s) => s.value === persona.style)?.title || 'По умолчанию'

  return (
    <div className="container view personalization-view">
      <div className="page-head">
        <div className="grow">
          <h1>Персонализация</h1>
          <p className="sub">Стиль и тон ответов агента.</p>
        </div>
        <Sparkles size={22} color="var(--text-3)" style={{ marginTop: 4, flexShrink: 0 }} />
      </div>

      {/* Базовый стиль и тон — большая карточка со значением под заголовком. */}
      <div className="settings-group">
        <div className="persona-select persona-select-wide">
          <button
            type="button"
            className={'persona-row persona-row-big' + (openName === 'style' ? ' is-open' : '')}
            aria-haspopup="listbox"
            aria-expanded={openName === 'style'}
            onClick={() => {
              setOpenName(openName === 'style' ? '' : 'style')
            }}
          >
            <span className="persona-row-stack">
              <span className="persona-row-label">Базовый стиль и тон</span>
              <span className="persona-row-sub">{styleLabel}</span>
            </span>
            <ChevronBig open={openName === 'style'} />
          </button>
          {openName === 'style' ? (
            <>
              <div className="persona-backdrop" onClick={() => setOpenName('')} />
              <div className="persona-pop" role="listbox" aria-label="Базовый стиль и тон">
                {STYLE_CHOICES.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={o.value === persona.style}
                    className={'persona-pop-item' + (o.value === persona.style ? ' is-active' : '')}
                    onClick={() => {
                      setOpenName('')
                      patch({ style: o.value as StyleTone })
                    }}
                  >
                    <span className="persona-pop-text">
                      <span className="persona-pop-title">{o.title}</span>
                      <span className="persona-pop-sub">{o.sub}</span>
                    </span>
                    {o.value === persona.style ? <Check size={18} className="persona-pop-check" /> : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Форма ответа: четыре строки с меню «Более / По умолчанию / Менее». */}
      <div className="settings-group">
        <div className="persona-card">
          <PersonaSelect
            name="friendliness"
            label="Дружелюбие"
            value={persona.friendliness}
            options={levelOptions('friendliness')}
            openName={openName}
            onOpenChange={setOpenName}
            onChange={(v) => patch({ friendliness: v })}
          />
          <PersonaSelect
            name="enthusiasm"
            label="Энтузиазм"
            value={persona.enthusiasm}
            options={levelOptions('enthusiasm')}
            openName={openName}
            onOpenChange={setOpenName}
            onChange={(v) => patch({ enthusiasm: v })}
          />
          <PersonaSelect
            name="headers"
            label="Заголовки и списки"
            value={persona.headers}
            options={levelOptions('headers')}
            openName={openName}
            onOpenChange={setOpenName}
            onChange={(v) => patch({ headers: v })}
          />
          <PersonaSelect
            name="emoji"
            label="Эмодзи"
            value={persona.emoji}
            options={levelOptions('emoji')}
            openName={openName}
            onOpenChange={setOpenName}
            onChange={(v) => patch({ emoji: v })}
          />
        </div>
      </div>

      {/* Род агента — прежняя настройка (с 0.155). */}
      <div className="settings-group">
        <div className="settings-label">Ассистент</div>
        <div className="settings-card">
          <div className="settings-row">
            <div className="icon-wrap">
              <UserRound size={16} />
            </div>
            <div className="grow">
              <div className="n">Род агента</div>
              <div className="d">Как агент говорит о себе: «я сделал» или «я сделала»</div>
            </div>
            <Segmented
              value={gender}
              onChange={(v) => {
                setGender(v as Gender)
              }}
              options={GENDER_CHOICES.map((c) => ({
                value: c.value,
                /* На узком экране «Мужской/Женский» не помещаются рядом с подписью.
                   Короткие подписи показывает CSS (.seg-short). */
                label: (
                  <>
                    <span className="seg-long">{c.title}</span>
                    <span className="seg-short">{c.short}</span>
                  </>
                ),
                title: c.hint,
              }))}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function ChevronBig({ open }: { open: boolean }) {
  return (
    <svg
      className={'persona-caret-big' + (open ? ' is-open' : '')}
      width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}
