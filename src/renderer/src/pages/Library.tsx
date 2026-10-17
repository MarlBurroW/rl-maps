import { useDeferredValue, useMemo, useState } from 'react'
import { Dices, FolderInput, RefreshCw, Search, Store, Upload } from 'lucide-react'
import { useApp, type Item } from '../state'
import { formatBytes, normalize } from '../lib/format'
import { MapCard } from '../components/MapCard'
import { Button } from '../components/Button'
import { FavoritesChip, Grid } from './Market'

type LibrarySort = 'added' | 'played' | 'name' | 'size'

const time = (iso?: string) => (iso ? Date.parse(iso) : 0)
const SORTS: Record<LibrarySort, { label: string; compare: (a: Item, b: Item) => number }> = {
  added: { label: 'Ajoutées récemment', compare: (a, b) => time(b.local?.addedAt) - time(a.local?.addedAt) },
  played: { label: 'Jouées récemment', compare: (a, b) => time(b.local?.lastPlayedAt) - time(a.local?.lastPlayedAt) },
  name: { label: 'Nom (A → Z)', compare: (a, b) => a.name.localeCompare(b.name) },
  size: { label: 'Plus lourdes', compare: (a, b) => (b.local?.size ?? 0) - (a.local?.size ?? 0) }
}

export function LibraryPage({ onOpen, onBrowse }: { onOpen: (item: Item) => void; onBrowse: () => void }) {
  const { library, localItem, importFiles, busy, favorites, updates, updateAll, settings, play, status } = useApp()
  const [query, setQuery] = useState('')
  const [favOnly, setFavOnly] = useState(false)
  const [sort, setSort] = useState<LibrarySort>('added')
  const q = useDeferredValue(normalize(query.trim()))

  const items = useMemo(() => library.map(localItem), [library, localItem])
  const favCount = items.filter((i) => favorites.has(i.favId)).length
  const totalSize = library.reduce((sum, m) => sum + m.size, 0)
  const shown = items
    .filter(
      (i) =>
        (!favOnly || favorites.has(i.favId)) &&
        (!q || normalize(`${i.name} ${i.author ?? ''} ${i.tags.join(' ')}`).includes(q))
    )
    .sort(SORTS[sort].compare)

  /** Charge une map au hasard parmi celles affichées (hors celle déjà en jeu). */
  const playRandom = () => {
    const loaded = status?.slot.kind === 'custom' ? status.slot.mapId : null
    const pool = shown.filter((i) => i.local && i.local.id !== loaded)
    const pick = pool[Math.floor(Math.random() * pool.length)]
    if (pick?.local) void play(pick.local)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-4 px-8 pt-7 pb-5">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <h1 className="font-display text-2xl font-bold">Bibliothèque</h1>
            <p className="mt-1 text-sm text-muted">
              {library.length === 0
                ? 'Tes maps installées apparaîtront ici.'
                : `${library.length} map${library.length > 1 ? 's' : ''} installée${library.length > 1 ? 's' : ''} · ${formatBytes(totalSize)} sur le disque. Glisse un fichier dans la fenêtre pour en ajouter.`}
            </p>
          </div>
          {library.length > 0 && (
            <div className="relative w-72">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher dans tes maps…"
                className="h-10 w-full rounded-lg border border-line bg-surface pr-3 pl-9 text-sm outline-none placeholder:text-faint focus:border-blue"
              />
            </div>
          )}
          <Button icon={<FolderInput className="size-4" />} busy={busy === 'import'} onClick={() => void importFiles(null)}>
            Importer un fichier
          </Button>
        </div>
        {library.length > 0 && (
          <div className="flex items-center gap-1.5">
            <FavoritesChip active={favOnly} count={favCount} onClick={() => setFavOnly((v) => !v)} />
            <div className="ml-auto flex items-center gap-2">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as LibrarySort)}
                className="h-8 rounded-lg border border-line bg-surface px-2.5 text-[13px] outline-none focus:border-blue"
                aria-label="Trier"
              >
                {Object.entries(SORTS).map(([id, s]) => (
                  <option key={id} value={id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="play"
                icon={<Dices className="size-4" />}
                disabled={!status?.valid || shown.filter((i) => i.local).length < 2 || (busy?.startsWith('play:') ?? false)}
                title="Charge une map au hasard parmi celles affichées"
                onClick={playRandom}
              >
                Au hasard
              </Button>
            </div>
          </div>
        )}
        {updates.length > 0 && settings?.mapUpdates !== 'auto' && (
          <div className="flex items-center gap-3 rounded-xl border border-blue/30 bg-blue/5 px-4 py-2.5">
            <RefreshCw className="size-4 shrink-0 text-blue" />
            <p className="flex-1 text-sm">
              {updates.length === 1
                ? `Une nouvelle version de ${updates[0].name} est disponible.`
                : `${updates.length} maps ont une nouvelle version disponible.`}
            </p>
            <Button size="sm" variant="primary" onClick={() => void updateAll()}>
              {updates.length === 1 ? 'Mettre à jour' : 'Tout mettre à jour'}
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {library.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-5 rounded-2xl border-2 border-dashed border-line px-8 py-20 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-surface-2">
              <Upload className="size-6 text-muted" />
            </div>
            <div>
              <p className="font-display text-lg font-semibold">Aucune map pour l'instant</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                Installe des maps depuis le Market, ou glisse ici un fichier <b>.upk</b>, <b>.udk</b> ou <b>.zip</b> téléchargé
                ailleurs (Steam Workshop, Discord…).
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="primary" icon={<Store className="size-4" />} onClick={onBrowse}>
                Parcourir le Market
              </Button>
              <Button icon={<FolderInput className="size-4" />} onClick={() => void importFiles(null)}>
                Importer un fichier
              </Button>
            </div>
          </div>
        ) : shown.length === 0 ? (
          <div className="py-24 text-center text-muted">
            {favOnly && favCount === 0
              ? 'Aucun favori pour l’instant : clique sur le ♥ d’une map pour l’ajouter.'
              : 'Aucune map ne correspond à ta recherche.'}
          </div>
        ) : (
          <Grid>
            {shown.map((item) => (
              <MapCard key={item.key} item={item} badge={false} onOpen={() => onOpen(item)} />
            ))}
          </Grid>
        )}
      </div>
    </div>
  )
}
