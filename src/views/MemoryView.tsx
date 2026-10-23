/**
 * Память (0.182) — отдельный экран для работы с профилем памяти агента.
 * Перенесено из Персонализации, чтобы разделить настройки агента и личные данные.
 * Сохраняет текущий UI "Подробнее о вас" с textarea, которую можно тянуть пальцем.
 */
import { FileText, Fingerprint, FolderKanban, Pin, Save, Trash2, Upload, UserRound, User } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Button, Segmented } from '../components/ui'
import {
  clearProfile,
  fetchProfile,
  fileSize,
  fileToAttachment,
  profileStatusLine,
  saveProfile,
  signalsLine,
  type ProfileFields,
} from '../lib/api'
import { currentUserId, identityLine } from '../lib/identity'
import {
  PINNED_ACCEPT,
  PINNED_MAX,
  PROJECT_NOTE_MAX,
  PROJECT_TITLE_MAX,
  clearPinnedDocs,
  clearProjectMemory,
  listPinnedDocs,
  pinDoc,
  readProjectMemory,
  saveProjectMemory,
  setPinnedDocEnabled,
  unpinDoc,
  type PinnedDoc,
  type ProjectMemory,
} from '../lib/pinnedMemory'
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
  const [project, setProject] = useState<ProjectMemory>(() => readProjectMemory())
  const [pinned, setPinned] = useState<PinnedDoc[]>([])
  const [pinBusy, setPinBusy] = useState(false)
  const pinInputRef = useRef<HTMLInputElement | null>(null)

  const refreshPinned = useCallback(async () => {
    const list = await listPinnedDocs()
    setPinned(list)
    setProject(readProjectMemory())
  }, [])

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
    void refreshPinned()
    const onSync = () => { void refreshPinned() }
    window.addEventListener('mt-pinned-change', onSync)
    return () => window.removeEventListener('mt-pinned-change', onSync)
  }, [loadProfile, refreshPinned])

  function onSaveProject() {
    const saved = saveProjectMemory(project)
    setProject(saved)
    notify(saved.title.trim() || saved.note.trim() ? 'Память проекта сохранена для всех ваших чатов' : 'Память проекта пуста')
  }

  function onClearProject() {
    setProject(clearProjectMemory())
    notify('Память проекта очищена')
  }

  async function onPickPinFiles(files: FileList | null) {
    if (!files || !files.length) return
    setPinBusy(true)
    let added = 0
    let lastErr = ''
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      if (!f) continue
      const conv = await fileToAttachment(f)
      if (!conv.ok) {
        lastErr = conv.error
        continue
      }
      const res = await pinDoc({ name: conv.att.name, mime: conv.att.mime, size: conv.att.size, b64: conv.att.b64 })
      if (res.ok) added++
      else lastErr = res.error
    }
    await refreshPinned()
    setPinBusy(false)
    if (added > 0) notify(`Закреплено в памяти: ${added}`)
    else if (lastErr) notify(lastErr)
  }

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

      <div className="settings-group">
        <div className="settings-label">Память проекта и закреплённые файлы</div>
        <div className="settings-card">
          <div className="settings-row">
            <div className="icon-wrap">
              <FolderKanban size={16} />
            </div>
            <div className="grow">
              <div className="n">Рабочий проект между чатами</div>
              <div className="d">
                Закрепите смету, справочник или ТЗ один раз — агент видит их в каждом новом чате без повторной загрузки с телефона
              </div>
            </div>
            <Segmented
              value={project.enabled ? 'on' : 'off'}
              onChange={(v) => {
                const enabled = v === 'on'
                const next = saveProjectMemory({ ...project, enabled })
                setProject(next)
                notify(enabled ? 'Память проекта включена' : 'Память проекта на паузе')
              }}
              options={[
                { value: 'on', label: 'Вкл', title: 'Передавать проект в чаты' },
                { value: 'off', label: 'Пауза', title: 'Временно не передавать проект' },
              ]}
            />
          </div>

          <div className="settings-form">
            <label>
              <span>Название проекта</span>
              <input
                value={project.title}
                maxLength={PROJECT_TITLE_MAX}
                placeholder="Например, Ремонт квартиры / Складской учёт"
                onChange={(e) => setProject({ ...project, title: e.target.value })}
              />
            </label>
            <label>
              <span>Памятка и вводные проекта</span>
              <textarea
                value={project.note}
                maxLength={PROJECT_NOTE_MAX}
                rows={3}
                placeholder="Постоянные вводные: валюта, ставки, стек, требования ТЗ или формат таблиц"
                onChange={(e) => setProject({ ...project, note: e.target.value })}
              />
            </label>
            <div className="actions">
              <Button variant="primary" icon={Save} onClick={onSaveProject}>
                Сохранить проект
              </Button>
              <Button variant="ghost" icon={Trash2} onClick={onClearProject}>
                Очистить проект
              </Button>
            </div>
          </div>

          <div className="pinned-docs-block">
            <div className="pinned-docs-head">
              <div className="pinned-docs-title">
                <Pin size={14} />
                <span>Закреплённые файлы ({pinned.length}/{PINNED_MAX})</span>
              </div>
              <div className="pinned-docs-actions">
                <Button
                  variant="secondary"
                  icon={Upload}
                  disabled={pinBusy || pinned.length >= PINNED_MAX}
                  onClick={() => pinInputRef.current?.click()}
                >
                  Закрепить файл
                </Button>
                {pinned.length > 0 ? (
                  <Button
                    variant="ghost"
                    icon={Trash2}
                    disabled={pinBusy}
                    onClick={() => {
                      void clearPinnedDocs().then(() => {
                        void refreshPinned()
                        notify('Закреплённые файлы убраны')
                      })
                    }}
                  >
                    Убрать все
                  </Button>
                ) : null}
              </div>
              <input
                ref={pinInputRef}
                type="file"
                accept={PINNED_ACCEPT}
                multiple
                hidden
                onChange={(e) => {
                  void onPickPinFiles(e.target.files)
                  e.target.value = ''
                }}
              />
            </div>

            {pinned.length === 0 ? (
              <div className="hint">
                Пока нет закреплённых документов. Добавьте здесь или нажмите значок булавки у файла в меню «+ → Файлы».
              </div>
            ) : (
              <div className="pinned-docs-list">
                {pinned.map((doc) => (
                  <div key={doc.id} className={`pinned-doc-row${doc.enabled ? '' : ' is-off'}`}>
                    <FileText size={16} className="pinned-doc-ic" />
                    <div className="pinned-doc-meta">
                      <span className="pinned-doc-name">{doc.name}</span>
                      <span className="pinned-doc-sub">{fileSize(doc.size)} · {doc.enabled ? 'активен в чатах' : 'на паузе'}</span>
                    </div>
                    <button
                      type="button"
                      className={`pinned-doc-toggle${doc.enabled ? ' is-on' : ''}`}
                      onClick={() => {
                        void setPinnedDocEnabled(doc.id, !doc.enabled).then(setPinned)
                      }}
                    >
                      {doc.enabled ? 'Вкл' : 'Пауза'}
                    </button>
                    <button
                      type="button"
                      className="pinned-doc-del"
                      aria-label={`Открепить ${doc.name}`}
                      onClick={() => {
                        void unpinDoc(doc.id).then((list) => {
                          setPinned(list)
                          notify(`Откреплён: ${doc.name}`)
                        })
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
