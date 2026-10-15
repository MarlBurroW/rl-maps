import { useEffect } from 'react'
import { ExternalLink, Trash2, X } from 'lucide-react'
import { useApp, type Item } from '../state'
import { formatBytes } from '../lib/format'
import { Thumb } from './Thumb'
import { MapActions } from './MapActions'
import { FavoriteButton } from './FavoriteButton'
import { Button } from './Button'

export function MapDetail({ item, onClose }: { item: Item; onClose: () => void }) {
  const { remove, busy, status } = useApp()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const loaded = status?.slot.kind === 'custom' && item.local && status.slot.mapId === item.local.id

  // Un lien par registre où la map est publiée, sinon la page enregistrée à l'installation
  const links = item.market?.sources.length
    ? item.market.sources.filter((s) => s.homepage).map((s) => ({ label: s.name, url: s.homepage! }))
    : item.homepage
      ? [{ label: 'Page de la map', url: item.homepage }]
      : []

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-8 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-label={item.name}
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-up flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
      >
        <div className="relative shrink-0">
          <Thumb src={item.thumbnail} alt={item.name} ratio={false} className="h-80 w-full" />
          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/10 to-transparent" />
          <button
            onClick={onClose}
            className="absolute top-3 right-3 rounded-full bg-black/50 p-2 text-white/80 backdrop-blur hover:text-white"
            aria-label="Fermer"
          >
            <X className="size-5" />
          </button>
          <div className="absolute inset-x-6 bottom-4">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-3xl font-bold drop-shadow">{item.name}</h2>
              <FavoriteButton item={item} className="p-2" />
            </div>
            <p className="mt-1 text-sm text-muted">
              par <span className="text-fg">{item.author ?? 'Auteur inconnu'}</span> · {formatBytes(item.size)}
              {item.market?.version && <> · {item.market.version}</>}
            </p>
          </div>
        </div>

        <div className="selectable flex-1 space-y-5 overflow-y-auto px-6 pt-3 pb-6">
          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((t) => (
                <span key={t} className="rounded-md bg-surface-2 px-2 py-1 text-xs font-medium text-muted">
                  {t}
                </span>
              ))}
            </div>
          )}
          {(item.description || item.summary) && (
            <p className="text-[15px] leading-relaxed whitespace-pre-line text-fg/90">{item.description || item.summary}</p>
          )}
          {item.recommendedSettings && (
            <div className="rounded-xl border border-line bg-surface-2/60 p-4">
              <h3 className="text-xs font-semibold tracking-wider text-muted uppercase">Réglages conseillés</h3>
              <p className="mt-2 text-sm whitespace-pre-line">{item.recommendedSettings}</p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-line bg-surface-2/40 px-6 py-4">
          {links.map((l) => (
            <Button
              key={l.url}
              variant="ghost"
              size="sm"
              icon={<ExternalLink className="size-4" />}
              title={l.url}
              onClick={() => window.api.openExternal(l.url)}
            >
              {l.label}
            </Button>
          ))}
          {item.local && (
            <Button
              variant="danger"
              icon={<Trash2 className="size-4" />}
              busy={busy === `remove:${item.local.id}`}
              disabled={!!loaded}
              title={loaded ? "Restaure l'original avant de supprimer cette map" : undefined}
              onClick={async () => {
                await remove(item.local!)
                if (!item.market) onClose()
              }}
            >
              Supprimer
            </Button>
          )}
          <MapActions item={item} className="ml-auto min-w-36" />
        </div>
      </div>
    </div>
  )
}
