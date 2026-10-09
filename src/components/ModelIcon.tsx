import avatarUrl from '../assets/agent-avatar.webp'
import type { ModelAvatar } from '../lib/models'

export type BrandFamily =
  | 'metiger'
  | 'google'
  | 'qwen'
  | 'deepseek'
  | 'mistral'
  | 'openai'
  | 'anthropic'
  | 'xai'
  | 'meta'
  | 'zai'
  | 'nvidia'
  | 'cohere'
  | 'other'

/** Определяет семейство ИИ по id, имени и вендору модели для отрисовки оригинальной иконки. */
export function detectBrand(id?: string, vendor?: string, name?: string): BrandFamily {
  if (!id) return 'metiger'
  const s = `${id} ${vendor || ''} ${name || ''}`.toLowerCase()
  if (/gemini|gemma|\bgoogle\b/.test(s)) return 'google'
  if (/qwen|qwq|alibaba|tongyi/.test(s)) return 'qwen'
  if (/deepseek/.test(s)) return 'deepseek'
  if (/mistral|ministral|codestral|devstral|pixtral|magistral/.test(s)) return 'mistral'
  if (/openai|gpt-oss|\bgpt\b|\bo1\b|\bo3\b|\bo4\b/.test(s)) return 'openai'
  if (/claude|anthropic/.test(s)) return 'anthropic'
  if (/grok|\bxai\b|x\.ai/.test(s)) return 'xai'
  if (/llama|\bmeta\b/.test(s)) return 'meta'
  if (/\bglm\b|\bzai\b|z\.ai|z-ai|zhipu|chatglm/.test(s)) return 'zai'
  if (/nemotron|nvidia/.test(s)) return 'nvidia'
  if (/cohere|command-r|\bnorth\b|\baya\b/.test(s)) return 'cohere'
  return 'other'
}

interface ModelIconProps {
  id?: string
  vendor?: string
  name?: string
  avatar?: ModelAvatar
  className?: string
}

/**
 * Оригинальная векторная иконка модели (Gemini, Qwen, DeepSeek, Mistral, OpenAI,
 * Claude, Grok, Meta, Z.AI, Nvidia, Cohere) или аватарка тигра MeTiger для «Авто».
 */
export function ModelIcon({ id, vendor, name, avatar, className = '' }: ModelIconProps) {
  const brand = detectBrand(id, vendor, name)
  const cls = `m-av${className ? ' ' + className : ''} is-brand-${brand}`

  if (!id || brand === 'metiger') {
    return (
      <span className={cls} style={{ background: avatar?.bg || '#111' }}>
        <img src={avatarUrl} alt="" className="m-av-img" />
      </span>
    )
  }

  if (brand === 'google') {
    // Оригинальная 4-цветная звезда Google Gemini
    return (
      <span className={cls} style={{ background: 'transparent' }}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
          <path
            d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z"
            fill="url(#gemini-g1)"
          />
          <path
            d="M12 2C12 7.52 16.48 12 22 12L12 12V2Z"
            fill="#EA4335"
            fillOpacity="0.9"
          />
          <path
            d="M12 22C12 16.48 16.48 12 22 12L12 12V22Z"
            fill="#FBBC04"
            fillOpacity="0.92"
          />
          <path
            d="M2 12C7.52 12 12 16.48 12 22V12H2Z"
            fill="#34A853"
            fillOpacity="0.92"
          />
          <path
            d="M12 2C12 7.52 7.52 12 2 12H12V2Z"
            fill="#4285F4"
          />
          <defs>
            <linearGradient id="gemini-g1" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
              <stop stopColor="#4285F4" />
              <stop offset="0.5" stopColor="#EA4335" />
              <stop offset="1" stopColor="#FBBC04" />
            </linearGradient>
          </defs>
        </svg>
      </span>
    )
  }

  if (brand === 'qwen') {
    // Оригинальная фиолетово-белая геометрическая звезда Qwen
    return (
      <span className={cls} style={{ background: 'transparent' }}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
          <polygon points="12,2 20.5,7 20.5,17 12,22 3.5,17 3.5,7" fill="#635BFF" />
          <polygon points="12,4.2 18.6,15.8 5.4,15.8" stroke="#FFFFFF" strokeWidth="1.9" fill="none" strokeLinejoin="round" />
          <polygon points="12,19.8 18.6,8.2 5.4,8.2" stroke="#C4B5FD" strokeWidth="1.7" fill="none" strokeLinejoin="round" />
          <circle cx="12" cy="12" r="2.2" fill="#FFFFFF" />
        </svg>
      </span>
    )
  }

  if (brand === 'deepseek') {
    // Оригинальный синий кит DeepSeek
    return (
      <span className={cls} style={{ background: 'transparent' }}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
          <path
            d="M3.5 13.2C3.5 8.4 7.4 5 12.4 5C16.6 5 19.8 7.5 20.6 10.8C21.3 10.2 22.2 9.4 22.8 8.5C22.7 10.6 21.6 12.3 20.1 13.1C19.3 16.8 15.9 19.2 11.6 19.2C7.1 19.2 3.5 16.6 3.5 13.2Z"
            fill="#3B82F6"
          />
          <path
            d="M6.2 14.2C8.3 15.8 11.7 16.2 14.8 14.7"
            stroke="#DBEAFE"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <circle cx="15.5" cy="10.2" r="1.3" fill="#FFFFFF" />
        </svg>
      </span>
    )
  }

  if (brand === 'mistral') {
    // Оригинальная ступенчатая пиксельная «M» Mistral AI
    return (
      <span className={cls} style={{ background: 'transparent' }}>
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
          <rect x="3" y="4" width="3.6" height="3.6" fill="#FFD700" />
          <rect x="17.4" y="4" width="3.6" height="3.6" fill="#FFD700" />
          <rect x="3" y="7.6" width="7.2" height="3.6" fill="#FF9E00" />
          <rect x="13.8" y="7.6" width="7.2" height="3.6" fill="#FF9E00" />
          <rect x="3" y="11.2" width="3.6" height="3.6" fill="#FF6D00" />
          <rect x="8.4" y="11.2" width="7.2" height="3.6" fill="#FF6D00" />
          <rect x="17.4" y="11.2" width="3.6" height="3.6" fill="#FF6D00" />
          <rect x="3" y="14.8" width="3.6" height="5.2" fill="#FA3C00" />
          <rect x="17.4" y="14.8" width="3.6" height="5.2" fill="#FA3C00" />
        </svg>
      </span>
    )
  }

  if (brand === 'openai') {
    return (
      <span className={cls} style={{ background: '#10A37F' }}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
          <path
            d="M12 3.5C9.8 3.5 8 5 7.6 7C5.7 7.5 4.4 9.2 4.4 11.2C4.4 12.6 5.1 13.9 6.2 14.7C6 16.7 7.5 18.6 9.6 19C10.5 20.1 11.9 20.6 13.4 20.3C15.2 20 16.6 18.6 17 16.8C18.8 16.2 20 14.5 20 12.6C20 11.1 19.2 9.8 18 9C18.1 6.9 16.6 5 14.5 4.6C13.8 3.9 12.9 3.5 12 3.5Z"
            stroke="#FFFFFF"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <polygon points="12,8.2 15.3,10.1 15.3,13.9 12,15.8 8.7,13.9 8.7,10.1" stroke="#FFFFFF" strokeWidth="1.5" fill="none" />
        </svg>
      </span>
    )
  }

  if (brand === 'anthropic') {
    return (
      <span className={cls} style={{ background: '#D97757' }}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
          <path d="M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3L6.3 17.7" stroke="#FFF" strokeWidth="2.1" strokeLinecap="round" />
        </svg>
      </span>
    )
  }

  if (brand === 'xai') {
    return (
      <span className={cls} style={{ background: '#18181B', border: '1px solid rgba(255,255,255,0.16)' }}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="6.5" stroke="#FFFFFF" strokeWidth="1.9" />
          <path d="M5.5 18.5L18.5 5.5" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    )
  }

  if (brand === 'meta') {
    return (
      <span className={cls} style={{ background: 'linear-gradient(135deg, #0081FB 0%, #0064E0 100%)' }}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
          <path
            d="M4.5 14.5C4.5 10.5 6.8 8 9 8C11 8 12.4 9.8 13.8 12.2C15 14.2 16.1 15.5 17.3 15.5C18.6 15.5 19.5 14.2 19.5 12.3C19.5 10.1 18.2 8.2 16.4 8.2C15 8.2 13.8 9.3 12.2 11.8C10.8 14 9.6 15.5 7.6 15.5C5.7 15.5 4.5 14.5 4.5 14.5Z"
            stroke="#FFFFFF"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </span>
    )
  }

  if (brand === 'zai') {
    return (
      <span className={cls} style={{ background: 'linear-gradient(135deg, #2563EB 0%, #06B6D4 100%)' }}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
          <path d="M6 7h12L6 17h12" stroke="#FFFFFF" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    )
  }

  if (brand === 'nvidia') {
    return (
      <span className={cls} style={{ background: '#76B900' }}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
          <path d="M4 12C6.5 7.5 11.5 6.5 16.5 9.5C19 11 20 12 20 12C20 12 17 16.5 12 16.5C7 16.5 4 12 4 12Z" stroke="#FFF" strokeWidth="2" />
          <circle cx="12" cy="12" r="2.2" fill="#FFF" />
        </svg>
      </span>
    )
  }

  if (brand === 'cohere') {
    return (
      <span className={cls} style={{ background: 'linear-gradient(135deg, #3959CC 0%, #D97757 100%)' }}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
          <circle cx="9" cy="10" r="3.5" fill="#FFF" />
          <circle cx="16" cy="10" r="2.5" fill="#FFF" fillOpacity="0.8" />
          <rect x="6" y="15" width="12" height="3.5" rx="1.75" fill="#FFF" />
        </svg>
      </span>
    )
  }

  return (
    <span className={cls} style={{ background: avatar?.bg || 'linear-gradient(135deg, #4285F4 0%, #9B72CB 100%)' }}>
      {avatar?.mark || '?'}
    </span>
  )
}
