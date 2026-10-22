import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DownloadProgress, GameStatus, LibraryMap, MarketMap, MarketState, Result, Settings } from '../../shared/types'
import { isUpToDate } from '../../shared/updates'
import { useToast } from './components/Toast'
import { t } from '../../shared/i18n'

/** Vue unifiée d'une map, qu'elle vienne du market, de la bibliothèque, ou des deux. */
export interface Item {
  key: string
  /** Id servant aux favoris : celui de la bibliothèque, ou du registre si la map n'est pas installée */
  favId: string
  name: string
  author?: string
  size?: number | null
  tags: string[]
  thumbnail?: string | null
  summary?: string
  description?: string
  recommendedSettings?: string
  homepage?: string
  market?: MarketMap
  local?: LibraryMap
  /** Dépendances absentes du jeu (undefined : inconnu) */
  missing?: string[]
  /** Une version plus récente de la map installée est publiée */
  updateAvailable: boolean
}

export const playHint = (arena: string) => t('Dans Rocket League : Entraînement → Free Play → arène « {arena} ».', { arena })

interface AppState {
  status: GameStatus | null
  library: LibraryMap[]
  market: MarketState | null
  marketLoading: boolean
  progress: Record<string, DownloadProgress>
  busy: string | null
  settings: Settings | null
  saveSettings(patch: Partial<Settings>): Promise<void>
  reloadSettings(): Promise<void>
  /** Maps installées dont une nouvelle version est publiée */
  updates: Item[]
  update(item: Item): Promise<void>
  updateAll(): Promise<void>
  favorites: Set<string>
  toggleFavorite(item: Item): void
  refreshMarket(): Promise<void>
  install(m: MarketMap): Promise<LibraryMap | null>
  cancel(m: MarketMap): void
  play(map: LibraryMap): Promise<void>
  restore(): Promise<void>
  remove(map: LibraryMap): Promise<void>
  importFiles(paths: string[] | null): Promise<void>
  setStatus(s: GameStatus): void
  marketItem(m: MarketMap): Item
  localItem(l: LibraryMap): Item
}

const Ctx = createContext<AppState | null>(null)

export const useApp = () => {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp hors du provider')
  return ctx
}

export function AppProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const [status, setStatus] = useState<GameStatus | null>(null)
  const [library, setLibrary] = useState<LibraryMap[]>([])
  const [market, setMarket] = useState<MarketState | null>(null)
  const [marketLoading, setMarketLoading] = useState(false)
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [settings, setSettings] = useState<Settings | null>(null)

  const reloadLibrary = useCallback(() => window.api.getLibrary().then(setLibrary), [])

  const refreshMarket = useCallback(async (refresh = true) => {
    setMarketLoading(true)
    try {
      setMarket(await window.api.getMarket(refresh))
    } finally {
      setMarketLoading(false)
    }
  }, [])

  useEffect(() => {
    void window.api.getStatus().then(setStatus)
    void reloadLibrary()
    void refreshMarket(false)
    void window.api.getSettings().then((s) => {
      setSettings(s)
      setFavorites(new Set(s.favorites))
    })
    const offStatus = window.api.onStatus(setStatus)
    const offProgress = window.api.onProgress((p) =>
      setProgress((prev) => {
        const next = { ...prev }
        if (p.phase === 'done' || p.phase === 'error') delete next[p.registryId]
        else next[p.registryId] = p
        return next
      })
    )
    return () => {
      offStatus()
      offProgress()
    }
  }, [reloadLibrary, refreshMarket])

  // Changement de dossier du jeu : la compatibilité des maps est à recalculer
  const installRoot = status?.install?.root
  useEffect(() => {
    if (!installRoot) return
    void reloadLibrary()
    void window.api.getMarket(false).then(setMarket)
  }, [installRoot, reloadLibrary])

  /** Exécute une action qui renvoie un Result et affiche l'erreur éventuelle. */
  const run = useCallback(
    async <T,>(key: string, action: () => Promise<Result<T>>, errorTitle: string): Promise<T | null> => {
      setBusy(key)
      try {
        const r = await action()
        if (!r.ok) {
          toast('error', errorTitle, r.error)
          return null
        }
        return r.value
      } finally {
        setBusy(null)
      }
    },
    [toast]
  )

  const saveSettings = useCallback(async (patch: Partial<Settings>) => setSettings(await window.api.updateSettings(patch)), [])
  const reloadSettings = useCallback(async () => setSettings(await window.api.getSettings()), [])

  const install = useCallback(
    async (m: MarketMap, opts: { update?: boolean } = {}) => {
      setProgress((p) => ({ ...p, [m.id]: { registryId: m.id, received: 0, total: m.download.size ?? null, phase: 'download' } }))
      const r = await window.api.installFromMarket(m.sourceId, m.id)
      await reloadLibrary()
      if (!r.ok) {
        setProgress((p) => {
          const next = { ...p }
          delete next[m.id]
          return next
        })
        if (r.error !== t('Téléchargement annulé')) toast('error', t('Échec : {name}', { name: m.name }), r.error)
        return null
      }
      if (opts.update) toast('success', t('{name} mise à jour', { name: m.name }), t('La dernière version publiée est installée.'))
      else toast('success', t('{name} installée', { name: m.name }), t('Clique sur « Jouer » pour la charger dans le jeu.'))
      return r.value
    },
    [reloadLibrary, toast]
  )

  const play = useCallback(
    async (map: LibraryMap) => {
      const s = await run(`play:${map.id}`, () => window.api.loadMap(map.id), t('Impossible de charger la map'))
      if (s) {
        setStatus(s)
        void reloadLibrary() // date de dernière partie
        const arena = s.slot.kind === 'custom' ? s.slot.arena : 'Underpass'
        const moved = s.slot.kind === 'custom' && s.slot.slot !== 'underpass'
        toast(
          'success',
          t('{name} est prête', { name: map.name }),
          playHint(arena) +
            (moved ? '\n' + t('Cette map réutilise des éléments d’Underpass : elle est chargée dans {arena} pour les garder intacts.', { arena }) : '')
        )
      }
    },
    [run, toast, reloadLibrary]
  )

  const restore = useCallback(async () => {
    const s = await run('restore', () => window.api.restoreOriginal(), t('Restauration impossible'))
    if (s) {
      setStatus(s)
      toast('info', t('Map d’origine restaurée'), t('Les arènes d’origine sont de retour, tu peux rejouer en ligne.'))
    }
  }, [run, toast])

  const remove = useCallback(
    async (map: LibraryMap) => {
      const ok = await run(`remove:${map.id}`, () => window.api.removeMap(map.id), t('Suppression impossible'))
      if (ok !== null) await reloadLibrary()
    },
    [run, reloadLibrary]
  )

  const importFiles = useCallback(
    async (paths: string[] | null) => {
      const maps = await run(
        'import',
        () => (paths ? window.api.importFiles(paths) : window.api.pickAndImport()),
        t('Import impossible')
      )
      await reloadLibrary()
      if (maps?.length) {
        toast('success', maps.length === 1 ? t('{name} ajoutée', { name: maps[0].name }) : t('{n} maps ajoutées', { n: maps.length }), t('Elles sont dans ta bibliothèque.'))
      }
    },
    [run, reloadLibrary, toast]
  )

  const toggleFavorite = useCallback((item: Item) => {
    const on = !favorites.has(item.favId)
    setFavorites((prev) => {
      const next = new Set(prev)
      if (on) next.add(item.favId)
      else next.delete(item.favId)
      return next
    })
    void window.api.setFavorite(item.favId, on).then((ids) => setFavorites(new Set(ids)))
  }, [favorites])

  const byRegistryId = useMemo(() => {
    const byId = new Map(library.filter((l) => l.registryId).map((l) => [l.registryId!, l]))
    for (const map of market?.maps ?? []) {
      const installed = (map.registryIds ?? [map.id]).map((id) => byId.get(id)).find(Boolean)
      if (installed) byId.set(map.id, installed)
    }
    return byId
  }, [library, market])

  const marketItem = useCallback(
    (m: MarketMap): Item => ({
      key: `m:${m.sourceId}:${m.id}`,
      favId: byRegistryId.get(m.id)?.id ?? m.id,
      name: m.name,
      author: m.author,
      size: m.download.size,
      tags: m.tags,
      thumbnail: m.thumbnail,
      summary: m.summary,
      description: m.description,
      recommendedSettings: m.recommendedSettings,
      homepage: m.homepage,
      market: m,
      local: byRegistryId.get(m.id),
      missing: byRegistryId.get(m.id)?.missing ?? m.missing,
      updateAvailable: !!byRegistryId.get(m.id) && !isUpToDate(byRegistryId.get(m.id)?.fingerprint, m.download)
    }),
    [byRegistryId]
  )

  const marketById = useMemo(() => new Map((market?.maps ?? []).flatMap((m) =>
    (m.registryIds ?? [m.id]).map((id) => [id, m] as const))), [market])

  const localItem = useCallback(
    (l: LibraryMap): Item => {
      const m = l.registryId ? marketById.get(l.registryId) : undefined
      return {
        key: `l:${l.id}`,
        favId: l.id,
        name: l.name,
        author: l.author,
        size: l.size,
        tags: l.tags,
        thumbnail: l.thumbnail ?? m?.thumbnail,
        summary: m?.summary,
        description: l.description,
        recommendedSettings: l.recommendedSettings,
        homepage: l.homepage,
        market: m,
        local: l,
        missing: l.missing ?? m?.missing,
        updateAvailable: !!m && !isUpToDate(l.fingerprint, m.download)
      }
    },
    [marketById]
  )

  const updates = useMemo(() => library.map(localItem).filter((i) => i.updateAvailable), [library, localItem])

  /** Installe la nouvelle version ; si la map est chargée dans le jeu, on y charge la nouvelle version. */
  const update = useCallback(
    async (item: Item) => {
      if (!item.market || !item.local || progress[item.market.id]) return
      const updated = await install(item.market, { update: true })
      if (updated && status?.slot.kind === 'custom' && status.slot.mapId === updated.id) {
        const s = await window.api.loadMap(updated.id)
        if (s.ok) setStatus(s.value)
        else toast('info', t('Nouvelle version prête'), t('Elle sera chargée dans le jeu au prochain « Jouer ».'))
      }
    },
    [install, progress, status, toast]
  )

  const updateAll = useCallback(async () => {
    for (const item of updates) if (item.market?.availability !== 'steam-required') await update(item)
  }, [updates, update])

  // Mode automatique : chaque mise à jour détectée est installée une fois par session
  const autoTried = useRef(new Set<string>())
  useEffect(() => {
    if (settings?.mapUpdates !== 'auto') return
    const pending = updates.filter((i) => i.market && i.market.availability !== 'steam-required' && !autoTried.current.has(i.market.id))
    if (!pending.length) return
    pending.forEach((i) => autoTried.current.add(i.market!.id))
    void (async () => {
      for (const item of pending) await update(item)
    })()
  }, [settings?.mapUpdates, updates, update])

  const value: AppState = {
    status,
    library,
    market,
    marketLoading,
    progress,
    busy,
    settings,
    saveSettings,
    reloadSettings,
    updates,
    update,
    updateAll,
    favorites,
    toggleFavorite,
    refreshMarket: () => refreshMarket(true),
    install: (m) => install(m),
    cancel: (m) => void window.api.cancelDownload(m.id),
    play,
    restore,
    remove,
    importFiles,
    setStatus,
    marketItem,
    localItem
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
