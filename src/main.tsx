import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { RootGuard } from './components/Guard'
import { isChunkLoadError, reloadForFreshChunks } from './lib/chunkReload'
import './styles/index.css'

// Vite сам сообщает о неудачной догрузке файла экрана этим событием — ловим его
// ДО React, чтобы протухшая выкладка не превращалась в экран «Приложение
// споткнулось» (0.157). Гасим событие только если действительно уходим на
// перезагрузку: иначе пусть ошибка дойдёт до Guard и будет видна.
window.addEventListener('vite:preloadError', (event) => {
  const payload = (event as Event & { payload?: unknown }).payload
  if (isChunkLoadError(payload) && reloadForFreshChunks()) event.preventDefault()
})

// Рендер сразу: данных с сервера для первого кадра не нужно
const root = createRoot(document.getElementById('root')!)
root.render(
  <StrictMode>
    {/* RootGuard (0.151): любая ошибка рендера — экран с причиной и кнопками
        «Перезагрузить»/«Сбросить данные» вместо немого белого экрана. */}
    <RootGuard>
      <App />
    </RootGuard>
  </StrictMode>,
)

