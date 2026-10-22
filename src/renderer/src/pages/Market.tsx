import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CircleCheck, CloudOff, Heart, RefreshCw, Search } from 'lucide-react'
import { useApp, type Item } from '../state'
import { normalize } from '../lib/format'
import { MapCard, MapCardSkeleton } from '../components/MapCard'
import { Button } from '../components/Button'
import { t } from '../../../shared/i18n'

type Sort = 'name' | 'size-asc' | 'size-desc'

/** Nombre de catégories affichées en pastilles, les autres sont dans un menu */
const VISIBLE_TAGS = 8

const selectClass = 'h-10 rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-blue'

export function MarketPage({ onOpen }: { onOpen: (item: Item) => void }) {
  const { market, marketLoading, refreshMarket, marketItem, favorites } = useApp()
  const [favOnly, setFavOnly] = useState(false)
  const [completeOnly, setCompleteOnly] = useState(false)
  const [installableOnly, setInstallableOnly] = useState(false)
  const [visible, setVisible] = useState(120)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('name')
  const q = useDeferredValue(normalize(query.trim()))
  useEffect(() => setVisible(120), [q, tag, source, sort, favOnly, completeOnly, installableOnly])

  const sources = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>()
    for (const m of market?.maps ?? [])
      for (const s of m.sources) counts.set(s.id, { name: s.name, count: (counts.get(s.id)?.count ?? 0) + 1 })
    // Même ordre que dans les réglages
    const order = Object.keys(market?.origin ?? {})
    return [...counts.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  }, [market])

  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of market?.maps ?? []) for (const tag of m.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag)
  }, [market])

  const items = useMemo(() => {
    const list = (market?.maps ?? []).filter(
      (m) =>
        (!installableOnly || m.availability !== 'steam-required') &&
        (!tag || m.tags.includes(tag)) &&
        (!source || m.sources.some((s) => s.id === source)) &&
        (!q || normalize(`${m.name} ${m.author} ${m.summary ?? ''} ${m.tags.join(' ')}`).includes(q))
    )
    const size = (x: (typeof list)[number]) => x.download.size ?? 0
    if (sort === 'size-asc') list.sort((a, b) => size(a) - size(b))
    else if (sort === 'size-desc') list.sort((a, b) => size(b) - size(a))
    return list
      .map(marketItem)
      .filter((i) => (!favOnly || favorites.has(i.favId)) && (!completeOnly || i.missing?.length === 0))
  }, [market, tag, source, q, sort, marketItem, favOnly, favorites, completeOnly, installableOnly])

  const favCount = useMemo(
    () => (market?.maps ?? []).filter((m) => favorites.has(marketItem(m).favId)).length,
    [market, favorites, marketItem]
  )

  const offline = market ? Object.values(market.origin).some((o) => o !== 'live') : false
  const visibleTags = tags.slice(0, VISIBLE_TAGS)
  const moreTags = tags.slice(VISIBLE_TAGS)

  const chip = (active: boolean) =>
    `h-7 rounded-full px-3 text-[13px] font-medium transition ${
      active ? 'bg-fg text-bg' : 'bg-surface text-muted hover:bg-surface-2 hover:text-fg'
    }`

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-4 px-8 pt-7 pb-4">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <h1 className="font-display text-2xl font-bold">Market</h1>
            <p className="mt-1 text-sm text-muted">
              {market
                ? t('{n} maps de {sources}.', {
                    n: market.maps.length,
                    sources: sources.map((s) => t(s.name)).join(', ') || t('la communauté')
                  })
                : t('Chargement du catalogue…')}
            </p>
          </div>
          <div className="relative w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Rechercher une map, un auteur…')}
              className="h-10 w-full rounded-lg border border-line bg-surface pr-3 pl-9 text-sm outline-none placeholder:text-faint focus:border-blue"
            />
          </div>
          {sources.length > 1 && (
            <select value={source ?? ''} onChange={(e) => setSource(e.target.value || null)} className={selectClass} aria-label={t('Source')}>
              <option value="">{t('Toutes les sources')}</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {t(s.name)} ({s.count})
                </option>
              ))}
            </select>
          )}
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={selectClass} aria-label={t('Trier')}>
            <option value="name">{t('Nom (A → Z)')}</option>
            <option value="size-asc">{t('Plus légères')}</option>
            <option value="size-desc">{t('Plus lourdes')}</option>
          </select>
          <Button
            variant="secondary"
            icon={<RefreshCw className={`size-4 ${marketLoading ? 'animate-spin' : ''}`} />}
            onClick={() => void refreshMarket()}
            disabled={marketLoading}
            aria-label={t('Actualiser le catalogue')}
            title={t('Actualiser le catalogue')}
          />
        </div>

        {!!market?.maps.length && (
          <div className="flex flex-wrap items-center gap-1.5">
            <FavoritesChip active={favOnly} count={favCount} onClick={() => setFavOnly((v) => !v)} />
            <button onClick={() => setInstallableOnly((v) => !v)} aria-pressed={installableOnly} className={chip(installableOnly)}>
              {t('Installables')}
            </button>
            <button
              onClick={() => setCompleteOnly((v) => !v)}
              aria-pressed={completeOnly}
              title={t("N'afficher que les maps dont toutes les dépendances sont présentes dans ton jeu")}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition ${
                completeOnly ? 'bg-ok text-bg' : 'bg-surface text-muted hover:bg-surface-2 hover:text-fg'
              }`}
            >
              <CircleCheck className={`size-3.5 ${completeOnly ? '' : 'text-ok'}`} />
              {t('Rendu complet')}
            </button>
            <span className="mx-1 h-5 w-px bg-line" />
            <button onClick={() => setTag(null)} className={chip(tag === null)}>
              {t('Toutes')}
            </button>
            {visibleTags.map((name) => (
              <button key={name} onClick={() => setTag(name)} className={chip(tag === name)}>
                {name}
              </button>
            ))}
            {moreTags.length > 0 && (
              <select
                value={tag && moreTags.includes(tag) ? tag : ''}
                onChange={(e) => setTag(e.target.value || null)}
                className={`${chip(!!tag && moreTags.includes(tag))} appearance-none pr-3 outline-none`}
                aria-label={t('Autres catégories')}
              >
                <option value="">{t('Plus…')}</option>
                {moreTags.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {offline && (
          <p className="flex items-center gap-2 text-[13px] text-muted">
            <CloudOff className="size-4" />
            {t('Registre en ligne injoignable pour certaines sources : affichage de la copie locale du catalogue.')}
          </p>
        )}
        {!!market?.errors.length && <div role="alert" className="space-y-1 text-[13px] text-warn">
          {market.errors.map((error) => <p key={error}>{error}</p>)}
        </div>}
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {!market ? (
          <Grid>
            {Array.from({ length: 12 }, (_, i) => (
              <MapCardSkeleton key={i} />
            ))}
          </Grid>
        ) : items.length === 0 ? (
          <div className="py-24 text-center text-muted">
            {market.maps.length === 0
              ? t('Aucune source de maps disponible. Vérifie les sources dans les réglages.')
              : favOnly && favCount === 0
                ? t('Aucun favori pour l’instant : clique sur le ♥ d’une map pour l’ajouter.')
                : t('Aucune map ne correspond à ta recherche.')}
          </div>
        ) : (
          <Grid>
            {items.slice(0, visible).map((item) => (
              <MapCard key={item.key} item={item} onOpen={() => onOpen(item)} />
            ))}
          </Grid>
        )}
        {items.length > visible && <div className="mt-6 flex justify-center">
          <Button onClick={() => setVisible((n) => n + 120)}>{t('Afficher plus ({n} restantes)', { n: items.length - visible })}</Button>
        </div>}
      </div>
    </div>
  )
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-4">{children}</div>
}

/** Pastille « ♥ Favoris » (partagée avec la bibliothèque). */
export function FavoritesChip({ active, count, onClick }: { active: boolean; count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition ${
        active ? 'bg-rose-500 text-white' : 'bg-surface text-muted hover:bg-surface-2 hover:text-fg'
      }`}
    >
      <Heart className={`size-3.5 ${active ? 'fill-current' : 'text-rose-500'}`} />
      {t('Favoris')}
      {count > 0 && <span className={`tabular-nums ${active ? 'text-white/80' : 'text-faint'}`}>{count}</span>}
    </button>
  )
}
