import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api, AppUpdateState, DownloadProgress, GameStatus, Result } from '../shared/types'

/** Le main renvoie toujours un Result : on le transmet tel quel… */
const result = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<Result<T>>

/** …ou on le déballe pour les appels qui ne doivent pas échouer côté UI. */
async function value<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = await result<T>(channel, ...args)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

function subscribe<T>(channel: string, cb: (payload: T) => void) {
  const listener = (_e: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: Api = {
  getSteamWorkshopConfig: () => value('steam:config'),
  setSteamWorkshopConfig: (patch) => result('steam:configure', patch),
  getSettings: () => value('settings:get'),
  updateSettings: (patch) => value('settings:update', patch),
  setFavorite: (id, favorite) => value('favorites:set', id, favorite),
  detectInstalls: () => value('game:detect'),
  pickInstallFolder: () => result('game:pickFolder'),

  getStatus: () => value('game:status'),
  loadMap: (mapId) => result('game:load', mapId),
  restoreOriginal: () => result('game:restore'),

  getLibrary: () => value('library:list'),
  importFiles: (paths) => result('library:import', paths),
  pickAndImport: () => result('library:pickAndImport'),
  removeMap: (mapId) => result('library:remove', mapId),

  getMarket: (refresh) => value('market:get', refresh),
  installFromMarket: (sourceId, registryId) => result('market:install', sourceId, registryId),
  cancelDownload: (registryId) => value('market:cancel', registryId),

  openExternal: (url) => value('shell:openExternal', url),
  openDataFolder: () => value('shell:openDataFolder'),
  getPathForFile: (file) => webUtils.getPathForFile(file),

  getAppUpdate: () => value('app:update:get'),
  checkAppUpdate: () => value('app:update:check'),
  installAppUpdate: () => value('app:update:install'),
  onAppUpdate: (cb) => subscribe<AppUpdateState>('app-update', cb),

  onStatus: (cb) => subscribe<GameStatus>('status', cb),
  onProgress: (cb) => subscribe<DownloadProgress>('progress', cb)
}

contextBridge.exposeInMainWorld('api', api)
