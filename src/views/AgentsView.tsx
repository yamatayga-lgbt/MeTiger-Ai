import {
  BarChart3,
  Bot,
  Code2,
  Languages,
  Palette,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react'
import { Badge, cx, type IconType } from '../components/ui'
import { haptic } from '../lib/telegram'
import { AGENTS, type AgentCardData } from '../lib/mock'

const ICONS: Record<AgentCardData['icon'], IconType> = {
  sparkles: Sparkles,
  code: Code2,
  search: Search,
  palette: Palette,
  chart: BarChart3,
  languages: Languages,
}

const STATUS: Record<
  AgentCardData['status'],
  { label: string; tone: 'green' | 'amber' | 'blue' }
> = {
  active: { label: 'Активен', tone: 'green' },
  draft: { label: 'Черновик', tone: 'amber' },
  soon: { label: 'Скоро', tone: 'blue' },
}

export function AgentsView({ onOpen }: { onOpen: (name: string) => void }) {
  return (
    <div className="container view">
      <div className="page-head">
        <div className="grow">
          <h1>Агенты</h1>
          <p className="sub">
            Готовые роли под конкретные задачи. Каждый агент — свой стиль, инструменты и модель.
            Скоро вы сможете создавать собственных агентов.
          </p>
        </div>
        <Bot size={22} color="var(--text-3)" style={{ marginTop: 4, flexShrink: 0 }} />
      </div>

      <div className="agent-grid">
        {AGENTS.map((agent, i) => {
          const Icon = ICONS[agent.icon]
          const status = STATUS[agent.status]
          return (
            <button
              key={agent.id}
              type="button"
              className="agent-card"
              style={{ animationDelay: `${i * 45}ms` }}
              onClick={() => {
                haptic('light')
                onOpen(agent.name)
              }}
            >
              <div className={cx('agent-icon', agent.tone !== 'accent' && agent.tone)}>
                <Icon size={19} />
              </div>
              <h3>{agent.name}</h3>
              <p className="desc">{agent.desc}</p>
              <div className="agent-foot">
                <Badge tone={status.tone}>
                  <span className="dot" />
                  {status.label}
                </Badge>
                <span className="sep">·</span>
                <span>{agent.model}</span>
                <span className="sep">·</span>
                <span>{agent.runs} запусков</span>
              </div>
            </button>
          )
        })}
      </div>

      <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center' }}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled
          style={{ opacity: 0.7 }}
          onClick={() => haptic('light')}
        >
          <Plus size={15} />
          Создать агента
          <Badge tone="gray">Скоро</Badge>
        </button>
      </div>
    </div>
  )
}
