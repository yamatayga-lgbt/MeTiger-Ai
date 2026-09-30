import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { loadTelegramSdk } from './lib/telegram'

// Рендер сразу, данные Telegram подтянутся когда SDK загрузится
const root = createRoot(document.getElementById('root')!)
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)

void loadTelegramSdk()
