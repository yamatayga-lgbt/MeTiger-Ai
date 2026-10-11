/**
 * Персонализация (0.155) — то, что раньше лежало в Настройках под заголовками
 * «Ассистент» и «Память»: три поля о человеке, род агента и кнопки записи.
 *
 * Отдельным экраном — потому что в списке профиля это строка «Персонализация»,
 * как в приложении ChatGPT, и потому что этот экран живой: он пишет профиль на
 * сервер, и его не хочется мешать с «Скоро»-заглушками.
 */
import { Fingerprint, Save, Trash2, UserRound } from 'lucide-react'
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
import { GENDER_CHOICES, isGender, type Gender } from '../lib/gender'
import { usePersistentState } from '../hooks/usePersistentState'
import { savePersonName } from '../lib/user'

interface PersonalizationViewProps {
  notify: (msg: string) => void
}

export function PersonalizationView({ notify }: PersonalizationViewProps) {
  /* Род агента читает отправка сообщения в App.tsx, поэтому ключ отдельный. */
  const [gender, setGender] = usePersistentState<Gender>('mt-gender', 'auto', isGender)

  const [prof, setProf] = useState<ProfileFields>({ name: '', job: '', about: '' })
  const [profStatus, setProfStatus] = useState('читаю…')
  const [profSignals, setProfSignals] = useState('')
  const [busy, setBusy] = useState(false)

  const loadProfile = useCallback(async () => {
    const r = await fetchProfile()
    if (r.ok && r.profile) {
      setProf({ name: r.profile.name || '', job: r.profile.job || '', about: r.profile.about || '' })
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
    const r = await saveProfile(prof)
    if (r.ok) {
      setProfStatus(r.unchanged ? 'ничего не изменилось — сохранилось как было' : profileStatusLine(r))
      setProfSignals(signalsLine(r))
      /* Имя нужно не только этому экрану: с ним приветствие в чате и нижняя панель
         называют человека, а не «Гость». Пишем рядом с серверной копией. */
      savePersonName(prof.name)
      notify(r.unchanged ? 'Менять нечего' : 'Записал: учту в следующих ответах')
    } else {
      /* Отказ сохранить человек должен видеть причиной, а не спиннером:
         слишком часто, нет KV, нет сети — это разные истории. */
      setProfStatus('Не сохранил: ' + (r.error || 'неизвестно'))
      notify('Профиль не сохранён')
    }
    setBusy(false)
  }

  async function onClear() {
    setBusy(true)
    const r = await clearProfile()
    if (r.ok) {
      setProf({ name: '', job: '', about: '' })
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
    <div className="container view personalization-view">
      <div className="page-head">
        <div className="grow">
          <h1>Персонализация</h1>
          <p className="sub">Что агент знает о вас и каким голосом говорит.</p>
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
              onChange={setGender}
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

      <div className="settings-group">
        <div className="settings-label">Память</div>
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
                Три поля уходят агенту в каждый ответ. Он опирается на них и не
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
