import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import type { DownloadProgress, GameInstall, GameStatus, Result, Settings } from '../shared/types'
import { Store } from './store'
import { Library, SUPPORTED_IMPORT_EXTS, THUMB_PROTOCOL } from './library/library'
import { Market } from './market/market'
import { download, downloadFirst } from './market/download'
import { detectInstalls, resolveInstallFolder } from './game/detect'
import { isGameRunning } from './game/process'
import { chooseSlot, isValidInstall, loadIntoSlot, readSlot, restoreSlot } from './game/slot'
import { readPackageImports } from './game/upk'
import { gamePackages } from './game/packages'
import { missingDependencies } from '../shared/compat'
import { downloadFingerprint } from '../shared/updates'
import type { MarketMap } from '../shared/types'

const STATUS_POLL_MS = 4000

// Permet de lancer une instance isolée (tests, dev) sans toucher aux données réelles.
// Doit précéder le verrou d'instance unique, qui dépend du dossier userData.
if (process.env.RLMAPS_USER_DATA) app.setPath('userData', process.env.RLMAPS_USER_DATA)

// Une seule instance : la seconde passe le relais à la première (événement second-instance)
if (!app.requestSingleInstanceLock()) app.exit(0)

protocol.registerSchemesAsPrivileged([
  { scheme: THUMB_PROTOCOL, privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const userData = app.getPath('userData')
const store = new Store(path.join(userData, 'settings.json'))
const library = new Library(path.join(userData, 'library'))
const market = new Market(
  path.join(userData, 'cache'),
  app.isPackaged
    ? path.join(process.resourcesPath, 'registry', 'sources')
    : path.join(app.getAppPath(), 'registry', 'sources')
)
const downloads = new Map<string, AbortController>()

let win: BrowserWindow | null = null
let lastStatus = ''

// ─── État du jeu ────────────────────────────────────────────────────────────

async function computeStatus(): Promise<GameStatus> {
  const install = store.settings.install
  const running = await isGameRunning()
  if (!install || !(await isValidInstall(install.root))) {
    return { install, valid: false, slot: { kind: 'original' }, running }
  }
  const { state, record } = await readSlot(install.root, store.slot)
  if (record !== store.slot) await store.update({ slot: record })
  return { install, valid: true, slot: state, running }
}

async function broadcastStatus(force = false): Promise<GameStatus> {
  const status = await computeStatus()
  const json = JSON.stringify(status)
  if (force || json !== lastStatus) {
    lastStatus = json
    win?.webContents.send('status', status)
  }
  return status
}

/**
 * Maps installées avant le suivi des versions : on leur attribue la version actuelle du registre,
 * pour pouvoir détecter les prochaines mises à jour.
 */
async function backfillFingerprints(maps: MarketMap[]) {
  const byId = new Map(maps.map((m) => [m.id, m]))
  for (const local of await library.list()) {
    const entry = local.registryId ? byId.get(local.registryId) : undefined
    if (entry && !local.fingerprint) await library.patch(local.id, { fingerprint: downloadFingerprint(entry.download) })
  }
}

/** Paquets du jeu installé, ou null si le jeu n'est pas configuré ou illisible. */
async function presentPackages(refresh = false): Promise<Set<string> | null> {
  const install = store.settings.install
  if (!install) return null
  return gamePackages(install.root, refresh).catch(() => null)
}

function requireInstall(): GameInstall {
  const install = store.settings.install
  if (!install) throw new Error("Dossier de Rocket League non configuré : va dans Réglages.")
  return install
}

// ─── IPC ────────────────────────────────────────────────────────────────────

/** Enregistre un handler dont les erreurs sont renvoyées proprement au renderer. */
function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<T>) {
  ipcMain.handle(channel, async (_e, ...args: A): Promise<Result<T>> => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (err) {
      const message = (err as Error).name === 'AbortError' ? 'Téléchargement annulé' : (err as Error).message
      return { ok: false, error: message }
    }
  })
}

function sendProgress(p: DownloadProgress) {
  win?.webContents.send('progress', p)
}

async function importPaths(paths: string[]) {
  const imported = []
  for (const p of paths) {
    if (!SUPPORTED_IMPORT_EXTS.includes(path.extname(p).toLowerCase())) {
      throw new Error(`${path.basename(p)} : seuls les fichiers .upk, .udk et .zip sont acceptés`)
    }
    if (!(await stat(p)).isFile()) throw new Error(`${path.basename(p)} n'est pas un fichier`)
    imported.push(await library.import(p))
  }
  return imported
}

function registerIpc() {
  handle('settings:get', async () => store.settings)
  handle('favorites:set', async (id: string, favorite: boolean) => {
    if (typeof id !== 'string' || !/^[\w.-]+$/.test(id)) throw new Error('Identifiant de map invalide')
    const rest = store.settings.favorites.filter((f) => f !== id)
    await store.update({ settings: { favorites: favorite ? [...rest, id] : rest } })
    return store.settings.favorites
  })
  handle('settings:update', async (patch: Partial<Settings>) => {
    await store.update({ settings: patch })
    await broadcastStatus(true)
    return store.settings
  })
  handle('game:detect', detectInstalls)
  handle('game:pickFolder', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Dossier de Rocket League',
      properties: ['openDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    const install = await resolveInstallFolder(res.filePaths[0])
    if (!install) throw new Error('Ce dossier ne contient pas Rocket League (TAGame/CookedPCConsole introuvable).')
    await store.update({ settings: { install } })
    await broadcastStatus(true)
    return install
  })

  handle('game:status', () => broadcastStatus(true))
  handle('game:load', async (mapId: string) => {
    const install = requireInstall()
    const map = await library.get(mapId)
    if (!map) throw new Error('Map introuvable dans la bibliothèque')
    const file = await library.mapFile(mapId)
    // Une map qui réutilise les assets d'Underpass doit être chargée dans une autre arène
    const slot = await chooseSlot(install.root, await readPackageImports(file))
    const record = await loadIntoSlot(install.root, file, map, slot)
    await library.patch(mapId, { lastPlayedAt: new Date().toISOString() })
    await store.update({ slot: record })
    return broadcastStatus(true)
  })
  handle('game:restore', async () => {
    await restoreSlot(requireInstall().root)
    await store.update({ slot: null })
    return broadcastStatus(true)
  })

  handle('library:list', async () => {
    const [maps, present] = await Promise.all([library.list(), presentPackages()])
    return maps.map((m) => ({ ...m, missing: missingDependencies(m.imports, present) }))
  })
  handle('library:import', importPaths)
  handle('library:pickAndImport', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Importer des maps',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Maps Rocket League', extensions: SUPPORTED_IMPORT_EXTS.map((e) => e.slice(1)) }]
    })
    return res.canceled ? [] : importPaths(res.filePaths)
  })
  handle('library:remove', async (mapId: string) => {
    const status = await computeStatus()
    if (status.slot.kind === 'custom' && status.slot.mapId === mapId) {
      throw new Error("Cette map est chargée dans le jeu : restaure l'original avant de la supprimer.")
    }
    await library.remove(mapId)
  })

  handle('market:get', async (refresh?: boolean) => {
    // Actualiser le catalogue relit aussi les paquets du jeu (il a pu être mis à jour entre-temps)
    const [state, present] = await Promise.all([market.get(store.settings.sources, refresh), presentPackages(refresh)])
    void backfillFingerprints(state.maps)
    return { ...state, maps: state.maps.map((m) => ({ ...m, missing: missingDependencies(m.imports, present) })) }
  })
  handle('market:install', async (sourceId: string, registryId: string) => {
    let entry = market.find(sourceId, registryId)
    if (!entry) {
      await market.get(store.settings.sources)
      entry = market.find(sourceId, registryId)
    }
    if (!entry) throw new Error('Map introuvable dans le registre')
    if (downloads.has(registryId)) throw new Error('Téléchargement déjà en cours')

    const controller = new AbortController()
    downloads.set(registryId, controller)
    const tmp = await mkdtemp(path.join(app.getPath('temp'), 'rlmaps-dl-'))
    try {
      const urls = [entry.download.url, ...(entry.download.mirrors ?? [])]
      const file = await downloadFirst(urls, tmp, `${entry.id}.zip`, {
        signal: controller.signal,
        onProgress: (received, total) =>
          sendProgress({ registryId, received, total: total ?? entry.download.size ?? null, phase: 'download' })
      })
      sendProgress({ registryId, received: 0, total: null, phase: 'extract' })

      let thumbnailFile: string | undefined
      if (entry.thumbnail) {
        thumbnailFile = await download(entry.thumbnail, path.join(tmp), 'thumb.jpg', {
          signal: AbortSignal.timeout(15_000)
        }).catch(() => undefined)
      }
      const map = await library.import(file, {
        registryId: entry.id,
        fingerprint: downloadFingerprint(entry.download),
        name: entry.name,
        author: entry.author,
        description: entry.description ?? entry.summary,
        recommendedSettings: entry.recommendedSettings,
        tags: entry.tags,
        homepage: entry.homepage,
        thumbnailFile,
        remoteThumbnail: entry.thumbnail
      })
      sendProgress({ registryId, received: 0, total: null, phase: 'done' })
      return map
    } catch (err) {
      sendProgress({ registryId, received: 0, total: null, phase: 'error', error: (err as Error).message })
      throw err
    } finally {
      downloads.delete(registryId)
      await rm(tmp, { recursive: true, force: true })
    }
  })
  handle('market:cancel', async (registryId: string) => {
    downloads.get(registryId)?.abort()
  })

  handle('shell:openExternal', async (url: string) => {
    if (/^https:\/\//.test(url)) await shell.openExternal(url)
  })
  handle('shell:openDataFolder', async () => {
    await shell.openPath(userData)
  })
}

// ─── Fenêtre ────────────────────────────────────────────────────────────────

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: '#0a0d14',
    title: 'RL Maps',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0d14', symbolColor: '#94a3b8', height: 44 },
    // En prod, l'icône vient de l'exécutable
    icon: app.isPackaged ? undefined : path.join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
}

app.on('second-instance', () => {
  if (win?.isMinimized()) win.restore()
  win?.focus()
})

app.whenReady().then(async () => {
  await store.load()
  if (!store.settings.install) {
    const [first] = await detectInstalls()
    if (first) await store.update({ settings: { install: first } })
  }

  protocol.handle(THUMB_PROTOCOL, (req) => {
    const url = new URL(req.url)
    const [id, file] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const resolved = url.hostname === 'library' && id && file ? library.resolveThumb(id, file) : null
    if (!resolved) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(resolved).href)
  })

  registerIpc()
  createWindow()
  setInterval(() => void broadcastStatus(), STATUS_POLL_MS)
})

// Restauration de l'original à la fermeture (si l'option est active et que c'est nous qui avons chargé la map).
let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  const install = store.settings.install
  if (!store.settings.restoreOnExit || !install || !store.slot) return
  e.preventDefault()
  quitting = true
  restoreSlot(install.root)
    .then(() => store.update({ slot: null }))
    .catch((err: Error) =>
      dialog.showErrorBox(
        'Restauration impossible',
        `La map d'origine n'a pas pu être remise en place : ${err.message}\n\nRelance RL Maps pour réessayer.`
      )
    )
    .finally(() => app.quit())
})

app.on('window-all-closed', () => app.quit())
