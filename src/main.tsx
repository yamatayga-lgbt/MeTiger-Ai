import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { RootGuard } from './components/Guard'
import './styles/index.css'

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

