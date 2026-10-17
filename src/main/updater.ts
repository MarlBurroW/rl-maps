// Mise à jour automatique de l'app à partir des releases GitHub.
// - Installeur (NSIS) : electron-updater télécharge en arrière-plan, l'installation se fait au
//   redémarrage (bouton dans l'app) ou à la prochaine fermeture.
// - Version portable : elle ne peut pas se remplacer elle-même, on signale juste la nouvelle version.

import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { AppUpdateState } from '../shared/types'
import { compareVersions } from '../shared/updates'

const { autoUpdater } = electronUpdater
const REPO = 'MarlBurroW/rl-maps'
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

let state: AppUpdateState = { kind: 'idle', current: app.getVersion() }
let notify: (s: AppUpdateState) => void = () => {}

function set(next: Omit<AppUpdateState, 'current'>) {
  state = { ...next, current: app.getVersion() }
  notify(state)
}

const isPortable = () => !!process.env.PORTABLE_EXECUTABLE_FILE

async function checkPortable() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const release = (await res.json()) as { tag_name: string; html_url: string }
  if (compareVersions(release.tag_name, app.getVersion()) > 0) {
    set({ kind: 'portable', version: release.tag_name.replace(/^v/, ''), url: release.html_url })
  } else {
    set({ kind: 'idle' })
  }
}

export async function checkForUpdates(): Promise<AppUpdateState> {
  if (!app.isPackaged) return state // pas de mise à jour en développement
  try {
    if (isPortable()) await checkPortable()
    else await autoUpdater.checkForUpdates()
  } catch (err) {
    set({ kind: 'error', error: (err as Error).message })
  }
  return state
}

export function installUpdate() {
  if (state.kind === 'ready') autoUpdater.quitAndInstall()
}

export const getUpdateState = () => state

export function initUpdater(onChange: (s: AppUpdateState) => void) {
  notify = onChange
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => set({ kind: 'checking' }))
  autoUpdater.on('update-not-available', () => set({ kind: 'idle' }))
  autoUpdater.on('update-available', (info) => set({ kind: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('download-progress', (p) => set({ kind: 'downloading', version: state.version, percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => set({ kind: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => set({ kind: 'error', error: err.message }))

  setTimeout(() => void checkForUpdates(), 5_000)
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS)
}
