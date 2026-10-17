import { Download, Play, Radio, RefreshCw, X } from 'lucide-react'
import type React from 'react'
import { useApp, type Item } from '../state'
import { formatBytes } from '../lib/format'
import { Button } from './Button'

/** Bouton d'action principal d'une map : Installer → progression → Jouer → En jeu. */
export function MapActions({ item, size = 'md', className = '' }: { item: Item; size?: 'sm' | 'md'; className?: string }) {
  const { status, progress, busy, install, cancel, play } = useApp()
  const local = item.local
  const p = item.market ? progress[item.market.id] : undefined

  if (p && item.market) {
    const pct = p.total ? Math.min(100, Math.round((p.received / p.total) * 100)) : null
    const label = p.phase === 'extract' ? 'Installation…' : pct !== null ? `${pct} %` : formatBytes(p.received)
    return (
      <div className={`flex items-center gap-2 ${className}`} onClick={(e) => e.stopPropagation()}>
        <div className={`relative flex-1 overflow-hidden rounded-lg bg-surface-2 ${size === 'sm' ? 'h-8' : 'h-10'}`}>
          <div
            className={`absolute inset-y-0 left-0 bg-blue/30 transition-[width] duration-200 ${p.phase === 'extract' ? 'w-full animate-pulse' : ''}`}
            style={p.phase === 'extract' ? undefined : { width: `${pct ?? 30}%` }}
          />
          <span className="relative flex h-full items-center justify-center text-[13px] font-semibold tabular-nums">{label}</span>
        </div>
        {p.phase === 'download' && (
          <button
            onClick={() => cancel(item.market!)}
            className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-fg"
            title="Annuler"
            aria-label="Annuler le téléchargement"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    )
  }

  if (local && status?.slot.kind === 'custom' && status.slot.mapId === local.id) {
    return (
      <div
        className={`inline-flex items-center justify-center gap-2 rounded-lg border border-orange/40 bg-orange/10 font-semibold text-orange ${
          size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm'
        } ${className}`}
      >
        <Radio className="size-4" /> En jeu
      </div>
    )
  }

  if (local) {
    return (
      <Button
        variant="play"
        size={size}
        className={className}
        icon={<Play className="size-4 fill-current" />}
        busy={busy === `play:${local.id}`}
        disabled={!status?.valid || (busy !== null && busy.startsWith('play:'))}
        title={status?.valid ? 'Charger cette map dans Rocket League' : 'Configure le dossier de Rocket League dans les réglages'}
        onClick={(e) => {
          e.stopPropagation()
          void play(local)
        }}
      >
        Jouer
      </Button>
    )
  }

  if (item.market) {
    const m = item.market
    return (
      <Button
        variant="primary"
        size={size}
        className={className}
        icon={<Download className="size-4" />}
        onClick={(e) => {
          e.stopPropagation()
          void install(m)
        }}
      >
        Installer
      </Button>
    )
  }

  return null
}

/** Bouton « Mettre à jour » quand une nouvelle version de la map installée est publiée. */
export function UpdateButton({ item, compact = false, className = '' }: { item: Item; compact?: boolean; className?: string }) {
  const { update, progress } = useApp()
  if (!item.updateAvailable || !item.market || progress[item.market.id]) return null
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    void update(item)
  }
  if (compact) {
    return (
      <button
        onClick={onClick}
        title="Une nouvelle version est disponible : mettre à jour"
        aria-label="Mettre à jour"
        className={`inline-flex size-8 items-center justify-center rounded-lg bg-blue/15 text-blue transition hover:bg-blue/25 ${className}`}
      >
        <RefreshCw className="size-4" />
      </button>
    )
  }
  return (
    <Button variant="primary" className={className} icon={<RefreshCw className="size-4" />} onClick={onClick}>
      Mettre à jour
    </Button>
  )
}
