/**
 * Админ-панель — только обращения (0.189).
 *
 * Решение владельца: список устройств убран совсем — осталась одна вкладка
 * «Обращения». Панель по-прежнему видит только владелец: пункт «Админ» в разделах
 * появляется лишь при его коде (Sidebar), а сервер ещё раз проверяет код по хэшу
 * (ownerOk в functions/api/report.js) — без кода любой запрос получает 403.
 */
import { ReportsView } from './ReportsView'

export function AdminView({ notify }: { notify: (msg: string) => void }) {
  return (
    <div className="container view admin-view">
      <div className="page-head">
        <div className="grow">
          <h1>Админ</h1>
          <p className="sub">Обращения. Панель видна только владельцу.</p>
        </div>
      </div>

      {/* Обращения — весь экран: свежие сверху, разбор статусов и фото внутри.
          Свой заголовок у обращений выключен (embedded): он был бы вторым подряд. */}
      <ReportsView notify={notify} embedded />
    </div>
  )
}
