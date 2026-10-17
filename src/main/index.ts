import { app, BrowserWindow, dialog, ipcMain, net, Notification, protocol, shell } from 'electron'
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
import { chooseSlot, isValidInstall, loadIntoSlot, readSlot, restoreSlot, selectExtras } from './game/slot'
import { readPackageImports } from './game/upk'
import { gamePackages } from './game/packages'
import { missingDependencies } from '../shared/compat'
import { downloadFingerprint } from '../shared/updates'
import { checkForUpdates, getUpdateState, initUpdater, installUpdate } from './updater'
import { createTray, updateTray } from './tray'
import { resolveLang, setLang, t } from '../shared/i18n'
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
    updateTray(status)
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
  if (!install) throw new Error(t('Dossier de Rocket League non configuré : va dans Réglages.'))
  return install
}

// ─── IPC ────────────────────────────────────────────────────────────────────

/** Enregistre un handler dont les erreurs sont renvoyées proprement au renderer. */
function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<T>) {
  ipcMain.handle(channel, async (_e, ...args: A): Promise<Result<T>> => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (err) {
      const message = (err as Error).name === 'AbortError' ? t('Téléchargement annulé') : (err as Error).message
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
      throw new Error(t('{file} : seuls les fichiers .upk, .udk et .zip sont acceptés', { file: path.basename(p) }))
    }
    if (!(await stat(p)).isFile()) throw new Error(t("{file} n'est pas un fichier", { file: path.basename(p) }))
    imported.push(await library.import(p))
  }
  return imported
}

function registerIpc() {
  handle('settings:get', async () => store.settings)
  handle('favorites:set', async (id: string, favorite: boolean) => {
    if (typeof id !== 'string' || !/^[\w.-]+$/.test(id)) throw new Error(t('Identifiant de map invalide'))
    const rest = store.settings.favorites.filter((f) => f !== id)
    await store.update({ settings: { favorites: favorite ? [...rest, id] : rest } })
    return store.settings.favorites
  })
  handle('settings:update', async (patch: Partial<Settings>) => {
    await store.update({ settings: patch })
    applyLanguage()
    await broadcastStatus(true)
    return store.settings
  })
  handle('game:detect', detectInstalls)
  handle('game:pickFolder', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: t('Dossier de Rocket League'),
      properties: ['openDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return null
    const install = await resolveInstallFolder(res.filePaths[0])
    if (!install) throw new Error(t('Ce dossier ne contient pas Rocket League (TAGame/CookedPCConsole introuvable).'))
    await store.update({ settings: { install } })
    await broadcastStatus(true)
    return install
  })

  handle('game:status', () => broadcastStatus(true))
  handle('game:load', async (mapId: string) => {
    const install = requireInstall()
    const map = await library.get(mapId)
    if (!map) throw new Error(t('Map introuvable dans la bibliothèque'))
    const file = await library.mapFile(mapId)
    // Une map qui réutilise les assets d'Underpass doit être chargée dans une autre arène
    const slot = await chooseSlot(install.root, await readPackageImports(file))
    // Paquets annexes (maps en plusieurs paquets) : copiés à côté, sans jamais remplacer un fichier du jeu
    const present = await gamePackages(install.root, true)
    const extras = selectExtras(await library.extraFiles(mapId), present, store.slot)
    const record = await loadIntoSlot(install.root, file, map, slot, { extras, previous: store.slot })
    await library.patch(mapId, { lastPlayedAt: new Date().toISOString() })
    await store.update({ slot: record })
    return broadcastStatus(true)
  })
  handle('game:restore', async () => {
    await restoreSlot(requireInstall().root, store.slot)
    await store.update({ slot: null })
    return broadcastStatus(true)
  })

  handle('library:list', async () => {
    const [maps, present] = await Promise.all([library.list(), presentPackages()])
    // Les paquets annexes livrés avec la map comptent comme présents
    return maps.map((m) => {
      const own = present && m.extras?.length ? new Set([...present, ...m.extras.map((e) => path.parse(e).name.toLowerCase())]) : present
      return { ...m, missing: missingDependencies(m.imports, own) }
    })
  })
  handle('library:import', importPaths)
  handle('library:pickAndImport', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: t('Importer des maps'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: t('Maps Rocket League'), extensions: SUPPORTED_IMPORT_EXTS.map((e) => e.slice(1)) }]
    })
    return res.canceled ? [] : importPaths(res.filePaths)
  })
  handle('library:remove', async (mapId: string) => {
    const status = await computeStatus()
    if (status.slot.kind === 'custom' && status.slot.mapId === mapId) {
      throw new Error(t("Cette map est chargée dans le jeu : restaure l'original avant de la supprimer."))
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
    if (!entry) throw new Error(t('Map introuvable dans le registre'))
    if (downloads.has(registryId)) throw new Error(t('Téléchargement déjà en cours'))

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

  handle('app:update:get', async () => getUpdateState())
  handle('app:update:check', () => checkForUpdates())
  handle('app:update:install', async () => installUpdate())

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

  // Fermer la fenêtre la cache seulement : l'app reste dans la zone de notification
  let hintShown = false
  win.on('close', (e) => {
    if (appQuitting || !store.settings.closeToTray) return
    e.preventDefault()
    win?.hide()
    if (!hintShown && Notification.isSupported()) {
      hintShown = true
      new Notification({
        title: t('RL Maps tourne en arrière-plan'),
        body: t("Clic sur l'icône près de l'horloge pour la rouvrir, clic droit pour quitter.")
      }).show()
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
}

function showWindow() {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

app.on('second-instance', showWindow)

/** Langue des messages du process principal : la même que l'interface. */
function applyLanguage() {
  setLang(resolveLang(store.settings.language, app.getLocale()))
}

app.whenReady().then(async () => {
  await store.load()
  applyLanguage()
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
  createTray(
    app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(app.getAppPath(), 'build', 'icon.ico'),
    {
      show: showWindow,
      restore: () => {
        const install = store.settings.install
        if (!install) return
        void restoreSlot(install.root, store.slot)
          .then(() => store.update({ slot: null }))
          .catch((err: Error) => dialog.showErrorBox(t('Restauration impossible'), err.message))
          .finally(() => void broadcastStatus(true))
      },
      quit: () => app.quit()
    }
  )
  initUpdater((s) => win?.webContents.send('app-update', s))
  setInterval(() => void broadcastStatus(), STATUS_POLL_MS)
})

// Restauration de l'original à la fermeture (si l'option est active et que c'est nous qui avons chargé la map).
let quitting = false
let appQuitting = false
app.on('before-quit', (e) => {
  appQuitting = true
  if (quitting) return
  const install = store.settings.install
  if (!store.settings.restoreOnExit || !install || !store.slot) return
  e.preventDefault()
  quitting = true
  restoreSlot(install.root, store.slot)
    .then(() => store.update({ slot: null }))
    .catch((err: Error) =>
      dialog.showErrorBox(
        t('Restauration impossible'),
        t("La map d'origine n'a pas pu être remise en place : {msg}", { msg: err.message }) + '\n\n' + t('Relance RL Maps pour réessayer.')
      )
    )
    .finally(() => app.quit())
})

app.on('window-all-closed', () => app.quit())
