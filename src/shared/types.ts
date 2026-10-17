// Types partagés entre le process main, le preload et le renderer.

export type Platform = 'epic' | 'steam' | 'custom'

export interface GameInstall {
  platform: Platform
  /** Racine de l'installation (dossier contenant TAGame/) */
  root: string
}

export interface RegistryDownload {
  url: string
  filename?: string | null
  size?: number | null
  sha256?: string
  /** Autres liens vers le même fichier, essayés si le premier échoue (quota Drive, lien mort…) */
  mirrors?: string[]
}

/** Une entrée d'un registre public (registry/sources/*.json). */
export interface RegistryMap {
  id: string
  name: string
  author: string
  summary?: string
  description?: string
  recommendedSettings?: string
  tags: string[]
  thumbnail?: string | null
  homepage?: string
  source?: string
  version?: string
  /** Paquets dont la map importe des objets (null : en-tête illisible) */
  imports?: string[] | null
  download: RegistryDownload
}

export interface RegistryIndex {
  version: 1
  name: string
  updatedAt: string
  maps: RegistryMap[]
}

export interface RegistrySource {
  id: string
  name: string
  url: string
  enabled: boolean
}

export interface MarketMap extends RegistryMap {
  sourceId: string
  /** Registres où la map apparaît (fusion des doublons entre sources) */
  sources: { id: string; name: string; homepage?: string }[]
  /** Dépendances absentes du jeu installé (undefined : inconnu) */
  missing?: string[]
}

export interface MarketState {
  maps: MarketMap[]
  /** 'live' = fraîchement téléchargé, 'cache' = dernière copie locale, 'bundled' = snapshot embarqué */
  origin: Record<string, 'live' | 'cache' | 'bundled' | 'error'>
  errors: string[]
}

/** Une map installée localement dans la bibliothèque. */
export interface LibraryMap {
  id: string
  name: string
  author?: string
  description?: string
  recommendedSettings?: string
  tags: string[]
  /** Nom du fichier .upk/.udk dans le dossier de la map */
  file: string
  size: number
  /** URL rlmaps:// vers la miniature locale, ou URL distante */
  thumbnail?: string | null
  /** Id du registre si la map vient du market */
  registryId?: string
  homepage?: string
  addedAt: string
  /** Dernière mise à jour depuis le registre */
  updatedAt?: string
  /** Dernier chargement dans le jeu */
  lastPlayedAt?: string
  /** Empreinte de la version installée (voir shared/updates.ts) */
  fingerprint?: string
  /** Paquets dont la map importe des objets (null : illisible) */
  imports?: string[] | null
  /** Dépendances absentes du jeu installé (undefined : inconnu) */
  missing?: string[]
}

/** Arène Labs dont le fichier sert à charger la map */
export type SlotId = 'underpass' | 'utopia'

export type SlotState =
  /** Fichier d'origine en place */
  | { kind: 'original' }
  /** Une map de la bibliothèque est chargée */
  | { kind: 'custom'; mapId: string; mapName: string; slot: SlotId; arena: string }
  /** Un backup existe mais la map chargée est inconnue (ancien outil, autre loader…) */
  | { kind: 'unknown' }

export interface GameStatus {
  install: GameInstall | null
  valid: boolean
  slot: SlotState
  running: boolean
}

export interface Settings {
  install: GameInstall | null
  restoreOnExit: boolean
  /** Fermer la fenêtre garde l'app dans la zone de notification */
  closeToTray: boolean
  /** Mises à jour des maps installées : proposées (badge + bouton) ou automatiques */
  mapUpdates: 'ask' | 'auto'
  /** Ids des maps favorites (id du registre ou de la bibliothèque, identiques pour une map installée depuis le market) */
  favorites: string[]
  sources: RegistrySource[]
}

export interface DownloadProgress {
  registryId: string
  received: number
  total: number | null
  phase: 'download' | 'extract' | 'done' | 'error'
  error?: string
}

/** État de la mise à jour de l'app elle-même */
export interface AppUpdateState {
  kind: 'idle' | 'checking' | 'downloading' | 'ready' | 'portable' | 'error'
  /** Version installée */
  current: string
  /** Version disponible */
  version?: string
  percent?: number
  /** Page de la release (version portable) */
  url?: string
  error?: string
}

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string }

/** Contrat IPC exposé au renderer via window.api */
export interface Api {
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  setFavorite(id: string, favorite: boolean): Promise<string[]>
  detectInstalls(): Promise<GameInstall[]>
  pickInstallFolder(): Promise<Result<GameInstall | null>>

  getStatus(): Promise<GameStatus>
  loadMap(mapId: string): Promise<Result<GameStatus>>
  restoreOriginal(): Promise<Result<GameStatus>>

  getLibrary(): Promise<LibraryMap[]>
  importFiles(paths: string[]): Promise<Result<LibraryMap[]>>
  pickAndImport(): Promise<Result<LibraryMap[]>>
  removeMap(mapId: string): Promise<Result>

  getMarket(refresh?: boolean): Promise<MarketState>
  installFromMarket(sourceId: string, registryId: string): Promise<Result<LibraryMap>>
  cancelDownload(registryId: string): Promise<void>

  openExternal(url: string): Promise<void>
  openDataFolder(): Promise<void>
  getPathForFile(file: File): string

  getAppUpdate(): Promise<AppUpdateState>
  checkAppUpdate(): Promise<AppUpdateState>
  installAppUpdate(): Promise<void>
  onAppUpdate(cb: (s: AppUpdateState) => void): () => void

  onStatus(cb: (s: GameStatus) => void): () => void
  onProgress(cb: (p: DownloadProgress) => void): () => void
}
