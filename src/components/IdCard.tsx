/**
 * «Придумайте себе ID» (0.176).
 *
 * Владелец: ID человек выбирает сам при первом заходе с устройства, без специальных
 * знаков — только буквы, максимум 15. Здесь именно это и происходит: одна карточка,
 * одно поле, живая подсказка по правилам.
 *
 * Почему карточка, а не экран во весь рост и не «обязательно заполните»: запирать
 * вход мы уже пробовали аккаунтами — владелец это отменил. Чат под карточкой живой,
 * «Позже» — честный ответ, ID потом ставится из профиля.
 */
import { Check, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from './ui'
import { claimId, idProblemLocal, ID_MAX, type MyDevice } from '../lib/devid'
import { haptic } from '../lib/haptic'

export function IdCard({ onDone, owner }: { onDone: (d?: MyDevice) => void; owner: boolean }) {
  const [id, setId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  /* Владельцу ID #Dev уже закреплён сервером: карточка ему не нужна, и показывать
     её — значит спрашивать то, что уже решено. */
  if (owner) return null

  const подсказка = idProblemLocal(id)
  const жив = !!id.trim() && !подсказка

  const сохранить = async () => {
    if (busy || !жив) return
    setBusy(true)
    setErr('')
    const r = await claimId(id.trim())
    setBusy(false)
    if (!r.ok) {
      setErr(String(r.error || 'не получилось — попробуйте ещё раз'))
      return
    }
    haptic('medium')
    onDone(r.device || undefined)
  }

  return (
    <div className="idc-overlay" role="dialog" aria-modal="true" aria-label="Ваш ID">
      <div className="idc-card">
        <div className="idc-head">
          <div className="idc-title">Придумайте себе ID</div>
          <button type="button" className="idc-close" aria-label="Позже" onClick={() => onDone()}>
            <X size={16} />
          </button>
        </div>

        <p className="idc-sub">
          По этому ID вас будет видно в обращениях и в админ-панели владельца.
          {id.trim()
            ? ' Менять можно раз в неделю.'
            : ' Например: #MeTiger. Менять можно раз в неделю.'}
        </p>

        <div className={`idc-field idc-field${подсказка && id ? ' is-bad' : ''}`}>
          <span className="idc-hash">#</span>
          <input
            type="text"
            inputMode="text"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Только латинские буквы"
            aria-label="Ваш ID"
            maxLength={ID_MAX}
            value={id}
            onChange={(e) => {
              /* Знаки и цифры не пропускаем вовсе: правило «только буквы» лучше
                 показать в момент ввода, чем отказать после нажатия. */
              setId(e.target.value.replace(/[^A-Za-z]/g, ''))
              setErr('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void сохранить()
            }}
          />
        </div>

        <div className="idc-hint">
          {подсказка && id ? подсказка : `От 4 до ${ID_MAX} латинских букв — без цифр и знаков.`}
        </div>

        {err ? <div className="auth-error">{err}</div> : null}

        <div className="idc-row">
          <Button variant="primary" icon={Check} onClick={() => void сохранить()} disabled={busy || !жив}>
            {busy ? 'Сохраняю…' : 'Сохранить ID'}
          </Button>
          <Button variant="ghost" onClick={() => onDone()}>
            Позже
          </Button>
        </div>
      </div>
    </div>
  )
}
