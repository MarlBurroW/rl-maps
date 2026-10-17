import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DownloadProgress, GameStatus, LibraryMap, MarketMap, MarketState, Result } from '../../shared/types'
import { useToast } from './components/Toast'

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
}

export const playHint = (arena: string) => `Dans Rocket League : Entraînement → Free Play → arène « ${arena} ».`

interface AppState {
  status: GameStatus | null
  library: LibraryMap[]
  market: MarketState | null
  marketLoading: boolean
  progress: Record<string, DownloadProgress>
  busy: string | null
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
    void window.api.getSettings().then((s) => setFavorites(new Set(s.favorites)))
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

  const install = useCallback(
    async (m: MarketMap) => {
      setProgress((p) => ({ ...p, [m.id]: { registryId: m.id, received: 0, total: m.download.size ?? null, phase: 'download' } }))
      const r = await window.api.installFromMarket(m.sourceId, m.id)
      await reloadLibrary()
      if (!r.ok) {
        setProgress((p) => {
          const next = { ...p }
          delete next[m.id]
          return next
        })
        if (r.error !== 'Téléchargement annulé') toast('error', `Échec : ${m.name}`, r.error)
        return null
      }
      toast('success', `${m.name} installée`, 'Clique sur « Jouer » pour la charger dans le jeu.')
      return r.value
    },
    [reloadLibrary, toast]
  )

  const play = useCallback(
    async (map: LibraryMap) => {
      const s = await run(`play:${map.id}`, () => window.api.loadMap(map.id), 'Impossible de charger la map')
      if (s) {
        setStatus(s)
        const arena = s.slot.kind === 'custom' ? s.slot.arena : 'Underpass'
        const moved = s.slot.kind === 'custom' && s.slot.slot !== 'underpass'
        toast(
          'success',
          `${map.name} est prête`,
          playHint(arena) + (moved ? `
Cette map réutilise des éléments d’Underpass : elle est chargée dans ${arena} pour les garder intacts.` : '')
        )
      }
    },
    [run, toast]
  )

  const restore = useCallback(async () => {
    const s = await run('restore', () => window.api.restoreOriginal(), 'Restauration impossible')
    if (s) {
      setStatus(s)
      toast('info', 'Map d’origine restaurée', 'Underpass est de retour, tu peux rejouer en ligne.')
    }
  }, [run, toast])

  const remove = useCallback(
    async (map: LibraryMap) => {
      const ok = await run(`remove:${map.id}`, () => window.api.removeMap(map.id), 'Suppression impossible')
      if (ok !== null) await reloadLibrary()
    },
    [run, reloadLibrary]
  )

  const importFiles = useCallback(
    async (paths: string[] | null) => {
      const maps = await run(
        'import',
        () => (paths ? window.api.importFiles(paths) : window.api.pickAndImport()),
        'Import impossible'
      )
      await reloadLibrary()
      if (maps?.length) {
        toast('success', maps.length === 1 ? `${maps[0].name} ajoutée` : `${maps.length} maps ajoutées`, 'Elles sont dans ta bibliothèque.')
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

  const byRegistryId = useMemo(() => new Map(library.filter((l) => l.registryId).map((l) => [l.registryId!, l])), [library])

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
      missing: byRegistryId.get(m.id)?.missing ?? m.missing
    }),
    [byRegistryId]
  )

  const marketById = useMemo(() => new Map((market?.maps ?? []).map((m) => [m.id, m])), [market])

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
        missing: l.missing ?? m?.missing
      }
    },
    [marketById]
  )

  const value: AppState = {
    status,
    library,
    market,
    marketLoading,
    progress,
    busy,
    favorites,
    toggleFavorite,
    refreshMarket: () => refreshMarket(true),
    install,
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
