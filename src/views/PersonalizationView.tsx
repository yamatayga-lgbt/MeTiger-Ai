/**
 * Персонализация (0.186) — стиль и тон агента, как в приложении ChatGPT.
 *
 * С 0.182 память живёт отдельным экраном, здесь — настройки формы ответа:
 * базовый стиль и тон, дружелюбие, энтузиазм, заголовки и списки, эмодзи,
 * быстрые ответы (переключатель), визуальные ответы. Плюс род агента,
 * который тут с 0.155. Раздела с кастомными инструкциями в экране нет:
 * владелец вычеркнул его на эскизе (15 окт 2026).
 *
 * Значения едут в /api/chat полем persona (src/lib/persona.ts) и превращаются
 * в блок системной подсказки на сервере (engine/personastyle.js).
 */
import { useState } from 'react'
import { Check, Sparkles, UserRound } from 'lucide-react'
import { Segmented } from '../components/ui'
import { PersonaSelect } from '../components/PersonaSelect'
import { GENDER_CHOICES, isGender, type Gender } from '../lib/gender'
import {
  DEFAULT_PERSONA, LEVEL_TITLES, STYLE_CHOICES, VISUAL_CHOICES,
  isPersona,
  type Level, type Persona, type StyleTone, type Visual,
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

export function PersonalizationView({ notify }: PersonalizationViewProps) {
  /* Род агента читает отправка сообщения в App.tsx, поэтому ключ отдельный. */
  const [gender, setGender] = usePersistentState<Gender>('mt-gender', 'auto', isGender)
  /* Персонализация — тем же путём: usePersistentState пишет JSON в mt-persona,
     чтение из отправки (readPersona) понимает тот же формат. */
  const [persona, setPersona] = usePersistentState<Persona>('mt-persona', DEFAULT_PERSONA, isPersona)
  /* Одно открытое меню на экран — как в ChatGPT. */
  const [openName, setOpenName] = useState('')

  function patch(next: Partial<Persona>) {
    setPersona((prev) => ({ ...prev, ...next }))
    notify('Настройка сохранена')
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
                    {o.value === persona.style ? <CheckIcon /> : null}
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

      {/* Быстрые ответы — переключатель с пояснением, как в ChatGPT. */}
      <div className="settings-group">
        <div className="settings-card">
          <div className="settings-row">
            <div className="grow">
              <div className="n">Быстрые ответы</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={persona.quick}
              className={'persona-switch' + (persona.quick ? ' is-on' : '')}
              aria-label="Быстрые ответы"
              onClick={() => patch({ quick: !persona.quick })}
            >
              <span className="persona-switch-knob" />
            </button>
          </div>
          <p className="persona-note">
            Иногда агент может отвечать из общих знаний, чтобы быстрее дать подробный ответ.
            Такие ответы не персонализированы и не используют вашу память.
          </p>
        </div>
      </div>

      {/* Визуальные ответы — карточка со значением под заголовком и пояснением. */}
      <div className="settings-group">
        <PersonaSelect
          name="visual"
          label="Визуальные ответы"
          value={persona.visual}
          options={VISUAL_CHOICES}
          fallback="По умолчанию"
          openName={openName}
          onOpenChange={setOpenName}
          onChange={(v) => patch({ visual: v as Visual })}
        />
        <p className="persona-note persona-note-plain">
          Разрешить агенту при необходимости создавать наглядные ответы: картинки и графики.
          «Простые» — отвечать текстом, если картинку не просили.
        </p>
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
                notify('Род агента сохранён')
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

function CheckIcon() {
  return <Check size={18} className="persona-pop-check" />
}
