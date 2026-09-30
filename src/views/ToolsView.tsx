import {
  Brain,
  FileText,
  Globe,
  ImagePlus,
  Mail,
  Mic,
  Puzzle,
  Terminal,
} from 'lucide-react'
import { Badge, Switch, type IconType } from '../components/ui'
import { usePersistentState } from '../hooks/usePersistentState'
import { TOOLS, type ToolData } from '../lib/mock'

const ICONS: Record<ToolData['icon'], IconType> = {
  globe: Globe,
  image: ImagePlus,
  file: FileText,
  terminal: Terminal,
  brain: Brain,
  mic: Mic,
  mail: Mail,
}

export function ToolsView() {
  const [tools, setTools] = usePersistentState<Record<string, boolean>>(
    'mt-tools',
    () => Object.fromEntries(TOOLS.map((t) => [t.id, t.enabled])),
  )

  const available = TOOLS.filter((t) => t.available)
  const upcoming = TOOLS.filter((t) => !t.available)

  const renderRow = (tool: ToolData) => {
    const Icon = ICONS[tool.icon]
    const on = tools[tool.id]
    return (
      <div key={tool.id} className={`tool-row${tool.available ? '' : ' dim'}`}>
        <div className={`tool-icon${tool.available && on ? ' on' : ''}`}>
          <Icon size={17} />
        </div>
        <div className="tool-meta">
          <div className="n">
            {tool.name}
            {!tool.available ? <Badge tone="gray">Скоро</Badge> : null}
          </div>
          <div className="d">{tool.desc}</div>
        </div>
        {tool.available ? (
          <Switch
            checked={on}
            label={tool.name}
            onChange={(v) => setTools((prev) => ({ ...prev, [tool.id]: v }))}
          />
        ) : (
          <Switch checked={false} label={tool.name} disabled onChange={() => undefined} />
        )}
      </div>
    )
  }

  return (
    <div className="container view">
      <div className="page-head">
        <div className="grow">
          <h1>Инструменты</h1>
          <p className="sub">
            Подключайте возможности к агентам: поиск, генерация изображений, файлы и многое другое.
          </p>
        </div>
        <Puzzle size={22} color="var(--text-3)" style={{ marginTop: 4, flexShrink: 0 }} />
      </div>

      <div className="tool-group-label">Доступно сейчас</div>
      <div className="tool-list">{available.map(renderRow)}</div>

      <div className="tool-group-label">В разработке</div>
      <div className="tool-list">{upcoming.map(renderRow)}</div>
    </div>
  )
}
