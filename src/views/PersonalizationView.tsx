/**
 * Персонализация (0.155) — настройки ассистента.
 * С 0.182 память вынесена в отдельный экран, здесь остаётся только род агента.
 *
 * Отдельным экраном — потому что в списке профиля это строка «Персонализация»,
 * как в приложении ChatGPT.
 */
import { UserRound } from 'lucide-react'
import { Segmented } from '../components/ui'
import { GENDER_CHOICES, isGender, type Gender } from '../lib/gender'
import { usePersistentState } from '../hooks/usePersistentState'

interface PersonalizationViewProps {
  notify: (msg: string) => void
}

export function PersonalizationView({ notify }: PersonalizationViewProps) {
  /* Род агента читает отправка сообщения в App.tsx, поэтому ключ отдельный. */
  const [gender, setGender] = usePersistentState<Gender>('mt-gender', 'auto', isGender)

  async function onSaveGender() {
    notify('Род агента сохранён')
  }

  return (
    <div className="container view personalization-view">
      <div className="page-head">
        <div className="grow">
          <h1>Персонализация</h1>
          <p className="sub">Настройки ассистента.</p>
        </div>
        <UserRound size={22} color="var(--text-3)" style={{ marginTop: 4, flexShrink: 0 }} />
      </div>

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
                void onSaveGender()
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
