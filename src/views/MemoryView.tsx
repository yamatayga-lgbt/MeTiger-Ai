/**
 * Память (0.182) — отдельный экран для работы с профилем памяти агента.
 * Перенесено из Персонализации, чтобы разделить настройки агента и личные данные.
 * Сохраняет текущий UI "Подробнее о вас" с textarea, которую можно тянуть пальцем.
 */
import { Fingerprint, Save, Trash2, UserRound, User } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Segmented } from '../components/ui'
import {
  clearProfile,
  fetchProfile,
  profileStatusLine,
  saveProfile,
  signalsLine,
  type ProfileFields,
} from '../lib/api'
import { currentUserId, identityLine } from '../lib/identity'
import { savePersonName } from '../lib/user'

const GENDER_OPTIONS = [
  { value: 'male', label: 'Мужской', short: 'М', hint: 'Агент будет отвечать как мужчина' },
  { value: 'female', label: 'Женский', short: 'Ж', hint: 'Агент будет отвечать как женщина' },
]

interface MemoryViewProps {
  notify: (msg: string) => void
}

export function MemoryView({ notify }: MemoryViewProps) {
  const [prof, setProf] = useState<ProfileFields>({ name: '', job: '', about: '', gender: '' })
  const [profStatus, setProfStatus] = useState('читаю…')
  const [profSignals, setProfSignals] = useState('')
  const [busy, setBusy] = useState(false)
  const [userGender, setUserGender] = useState('')

  const loadProfile = useCallback(async () => {
    const r = await fetchProfile()
    if (r.ok && r.profile) {
      setProf({ name: r.profile.name || '', job: r.profile.job || '', about: r.profile.about || '', gender: r.profile.gender || '' })
      setUserGender(r.profile.gender || '')
      setProfStatus(profileStatusLine(r))
      setProfSignals(signalsLine(r))
    } else {
      setProfStatus(r.error || 'профиль не прочитан')
    }
  }, [])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  async function onSave() {
    setBusy(true)
    const r = await saveProfile({ ...prof, gender: userGender })
    if (r.ok) {
      setProfStatus(r.unchanged ? 'ничего не изменилось — сохранилось как было' : profileStatusLine(r))
      setProfSignals(signalsLine(r))
      savePersonName(prof.name)
      notify(r.unchanged ? 'Менять нечего' : 'Записал: учту в следующих ответах')
    } else {
      setProfStatus('Не сохранил: ' + (r.error || 'неизвестно'))
      notify('Профиль не сохранён')
    }
    setBusy(false)
  }

  async function onClear() {
    setBusy(true)
    const r = await clearProfile()
    if (r.ok) {
      setProf({ name: '', job: '', about: '', gender: '' })
      setUserGender('')
      setProfStatus('профиль забыт · поля пустые')
      setProfSignals('')
      savePersonName('')
      notify('Профиль очищен')
    } else {
      setProfStatus('Не очистил: ' + (r.error || 'неизвестно'))
    }
    setBusy(false)
  }

  return (
    <div className="container view memory-view">
      <div className="page-head">
        <div className="grow">
          <h1>Память</h1>
          <p className="sub">Что агент знает о вас и учитывает в ответах.</p>
        </div>
        <UserRound size={22} color="var(--text-3)" style={{ marginTop: 4, flexShrink: 0 }} />
      </div>

      <div className="settings-group">
        <div className="settings-label">Чья это память</div>
        <div className="settings-card">
          <div className="settings-row">
            <div className="icon-wrap">
              <Fingerprint size={16} />
            </div>
            <div className="grow">
              <div className="n">Чья это память</div>
              <div className="d">
                {identityLine(currentUserId())} — у каждого человека своя, память
                необщая. Сменить ключ = начать с чистого листа
              </div>
            </div>
            <Badge tone="gray">Браузер</Badge>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-label">О вас</div>
        <div className="settings-card">
          <div className="settings-row">
            <div className="icon-wrap">
              <User size={16} />
            </div>
            <div className="grow">
              <div className="n">Ваш пол</div>
              <div className="d">
                Агент будет подстраиваться под ваш пол и отвечать соответствующим образом
              </div>
            </div>
            <Segmented
              value={userGender}
              onChange={(v) => {
                setUserGender(v as string)
              }}
              options={GENDER_OPTIONS.map((c) => ({
                value: c.value,
                label: (
                  <>
                    <span className="seg-long">{c.label}</span>
                    <span className="seg-short">{c.short}</span>
                  </>
                ),
                title: c.hint,
              }))}
            />
          </div>
          <div className="settings-form">
            <label>
              <span>Как вас зовут</span>
              <input
                value={prof.name}
                maxLength={60}
                placeholder="Например, Иван"
                onChange={(e) => setProf({ ...prof, name: e.target.value })}
              />
            </label>
            <label>
              <span>Ваша профессия или занятие</span>
              <input
                value={prof.job}
                maxLength={90}
                placeholder="Например, аналитик данных"
                onChange={(e) => setProf({ ...prof, job: e.target.value })}
              />
            </label>
            <label>
              <span>Подробнее о вас</span>
              <textarea
                value={prof.about}
                maxLength={1500}
                rows={4}
                placeholder="Интересы и предпочтения: что учитывать, отвечать коротко или подробно, нужны ли примеры и код"
                onChange={(e) => setProf({ ...prof, about: e.target.value })}
              />
              <span className="hint">
                Поля уходят агенту в каждый запрос. Он опирается на них и не
                выдумывает сверх написанного; в разговоре их не пересказывает.
              </span>
            </label>
            <div className="actions">
              <Button variant="primary" icon={Save} onClick={onSave} disabled={busy}>
                Сохранить
              </Button>
              <Button variant="ghost" icon={Trash2} onClick={onClear} disabled={busy}>
                Забыть
              </Button>
              <span className="hint">{profStatus}</span>
            </div>
            {profSignals ? <div className="settings-signals">{profSignals}</div> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
