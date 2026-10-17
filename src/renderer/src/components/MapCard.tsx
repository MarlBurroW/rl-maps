import { CircleCheck } from 'lucide-react'
import type { Item } from '../state'
import { formatBytes } from '../lib/format'
import { Thumb } from './Thumb'
import { MapActions } from './MapActions'
import { FavoriteButton } from './FavoriteButton'
import { CompatBadge } from './Compat'

export function MapCard({ item, onOpen, badge = true }: { item: Item; onOpen: () => void; badge?: boolean }) {
  return (
    <article
      onClick={onOpen}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-line bg-surface transition hover:-translate-y-0.5 hover:border-faint hover:shadow-xl hover:shadow-black/30"
    >
      <div className="relative">
        <Thumb src={item.thumbnail} alt={item.name} className="transition group-hover:brightness-110" />
        <FavoriteButton item={item} className="absolute top-2 left-2" />
        <CompatBadge missing={item.missing} className="absolute bottom-2 left-2" />
        {badge && item.local && item.market && (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-ok backdrop-blur">
            <CircleCheck className="size-3" /> Installée
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-3.5">
        <div className="min-w-0">
          <h3 className="truncate font-display text-[15px] font-semibold" title={item.name}>
            {item.name}
          </h3>
          <p className="mt-0.5 truncate text-[13px] text-muted">
            {item.author ?? 'Auteur inconnu'} · {formatBytes(item.size)}
          </p>
        </div>
        {item.summary && <p className="line-clamp-2 text-[13px] leading-snug text-faint">{item.summary}</p>}
        <div className="mt-auto flex items-center gap-2">
          <div className="flex min-w-0 flex-1 gap-1 overflow-hidden">
            {item.tags.slice(0, 2).map((t) => (
              <span key={t} className="truncate rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
                {t}
              </span>
            ))}
          </div>
          <MapActions item={item} size="sm" className="shrink-0" />
        </div>
      </div>
    </article>
  )
}

export function MapCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="skeleton aspect-video" />
      <div className="space-y-2 p-3.5">
        <div className="skeleton h-4 w-2/3 rounded" />
        <div className="skeleton h-3 w-1/3 rounded" />
        <div className="skeleton mt-4 h-8 rounded" />
      </div>
    </div>
  )
}
