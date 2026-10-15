import { LibraryBig, Settings, Store } from 'lucide-react'

export type Tab = 'market' | 'library' | 'settings'

const tabs: { id: Tab; label: string; icon: typeof Store }[] = [
  { id: 'market', label: 'Market', icon: Store },
  { id: 'library', label: 'Bibliothèque', icon: LibraryBig },
  { id: 'settings', label: 'Réglages', icon: Settings }
]

export function TitleBar({ tab, onTab, libraryCount }: { tab: Tab; onTab: (t: Tab) => void; libraryCount: number }) {
  return (
    // La zone à droite (≈140 px) est occupée par les boutons natifs de la fenêtre (titleBarOverlay).
    <header className="drag flex h-11 shrink-0 items-center gap-6 border-b border-line pr-36 pl-4">
      <div className="flex items-center gap-2">
        <Logo />
        <span className="font-display text-[15px] font-bold tracking-tight">RL Maps</span>
      </div>
      <nav className="no-drag flex h-full items-stretch gap-1">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTab(id)}
            className={`relative flex items-center gap-2 px-3 text-[13px] font-semibold transition ${
              tab === id ? 'text-fg' : 'text-muted hover:text-fg'
            }`}
          >
            <Icon className="size-4" />
            {label}
            {id === 'library' && libraryCount > 0 && (
              <span className="rounded-full bg-surface-2 px-1.5 text-[11px] text-muted tabular-nums">{libraryCount}</span>
            )}
            {tab === id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-blue" />}
          </button>
        ))}
      </nav>
    </header>
  )
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#f97316" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#lg)" />
      <path d="M7 21.5 16 8l9 13.5h-5.2L16 15.6l-3.8 5.9z" fill="#fff" />
      <circle cx="16" cy="24" r="2.2" fill="#fff" />
    </svg>
  )
}
