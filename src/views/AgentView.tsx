import {
  BarChart3,
  Brain,
  Code2,
  FileText,
  Globe,
  ImagePlus,
  Languages,
  Lightbulb,
  Mic,
  PenLine,
  Sparkles,
} from 'lucide-react'
import avatarUrl from '../assets/agent-avatar.png'
import { Badge, type IconType } from '../components/ui'
import { AGENT, CAPABILITIES, type Capability } from '../lib/mock'

const ICONS: Record<Capability['icon'], IconType> = {
  pen: PenLine,
  code: Code2,
  lightbulb: Lightbulb,
  chart: BarChart3,
  languages: Languages,
  globe: Globe,
  image: ImagePlus,
  file: FileText,
  mic: Mic,
  brain: Brain,
}

function CapChip({ cap }: { cap: Capability }) {
  const Icon = ICONS[cap.icon]
  return (
    <div className={`cap-chip${cap.soon ? ' dim' : ''}`}>
      <Icon size={15} />
      {cap.label}
    </div>
  )
}

/** Профиль единственного универсального агента. */
export function AgentView() {
  const now = CAPABILITIES.filter((c) => !c.soon)
  const soon = CAPABILITIES.filter((c) => c.soon)

  return (
    <div className="container view">
      <div className="page-head">
        <div className="grow">
          <h1>Агент</h1>
          <p className="sub">
            Один универсальный агент вместо десятка ролей — растёт и скоро сможет всё.
          </p>
        </div>
        <Sparkles size={22} color="var(--text-3)" style={{ marginTop: 4, flexShrink: 0 }} />
      </div>

      <div className="agent-hero-card">
        <img className="agent-avatar-lg" src={avatarUrl} alt="MeTiger Ai" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="agent-title-row">
            <h2>{AGENT.name}</h2>
            <Badge tone="green">
              <span className="dot" />
              Активен
            </Badge>
            <Badge tone="accent">beta</Badge>
          </div>
          <p className="agent-tagline">{AGENT.desc}</p>
          <div className="agent-stats">
            <div className="stat">
              <div className="l">Модель</div>
              <div className="v">{AGENT.model}</div>
            </div>
            <div className="stat">
              <div className="l">Режим</div>
              <div className="v">Универсал</div>
            </div>
            <div className="stat">
              <div className="l">Версия</div>
              <div className="v">{AGENT.version}</div>
            </div>
            <div className="stat">
              <div className="l">Запусков</div>
              <div className="v">{AGENT.runs}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="tool-group-label">Уже умеет</div>
      <div className="cap-grid">
        {now.map((c) => (
          <CapChip key={c.id} cap={c} />
        ))}
      </div>

      <div className="tool-group-label">Скоро</div>
      <div className="cap-grid">
        {soon.map((c) => (
          <CapChip key={c.id} cap={c} />
        ))}
      </div>
    </div>
  )
}
