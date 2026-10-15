// Détection automatique des installations de Rocket League (Epic, Steam, Heroic).

import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'
import type { GameInstall, Platform } from '../../shared/types'
import { isValidInstall } from './slot'

const EPIC_APP_NAME = 'Sugar'
const STEAM_APP_DIR = 'rocketleague'

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

async function epicCandidates(): Promise<string[]> {
  const programData = process.env.PROGRAMDATA ?? 'C:\\ProgramData'
  const dat = await readJson<{ InstallationList?: { AppName: string; InstallLocation: string }[] }>(
    path.join(programData, 'Epic', 'UnrealEngineLauncher', 'LauncherInstalled.dat')
  )
  const fromLauncher = (dat?.InstallationList ?? [])
    .filter((a) => a.AppName === EPIC_APP_NAME)
    .map((a) => a.InstallLocation)
  return [...fromLauncher, 'C:\\Program Files\\Epic Games\\rocketleague']
}

function steamPathFromRegistry(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true }, (err, out) => {
      if (err) return resolve(null)
      const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/)
      resolve(m ? path.normalize(m[1].trim()) : null)
    })
  })
}

/** Extrait les chemins de bibliothèques d'un libraryfolders.vdf */
export function parseLibraryFolders(vdf: string): string[] {
  return [...vdf.matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1].replace(/\\\\/g, '\\'))
}

async function steamCandidates(): Promise<string[]> {
  const roots =
    process.platform === 'win32'
      ? [await steamPathFromRegistry(), 'C:\\Program Files (x86)\\Steam']
      : [path.join(homedir(), '.steam', 'steam'), path.join(homedir(), '.local', 'share', 'Steam')]
  const libraries = new Set<string>()
  for (const root of roots) {
    if (!root) continue
    libraries.add(root)
    try {
      const vdf = await readFile(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8')
      for (const lib of parseLibraryFolders(vdf)) libraries.add(lib)
    } catch {
      /* pas de Steam ici */
    }
  }
  return [...libraries].map((lib) => path.join(lib, 'steamapps', 'common', STEAM_APP_DIR))
}

export async function detectInstalls(): Promise<GameInstall[]> {
  const candidates: [Platform, string[]][] =
    process.platform === 'win32'
      ? [
          ['epic', await epicCandidates()],
          ['steam', await steamCandidates()]
        ]
      : [
          ['epic', [path.join(homedir(), 'Games', 'Heroic', 'rocketleague')]],
          ['steam', await steamCandidates()]
        ]

  const found: GameInstall[] = []
  const seen = new Set<string>()
  for (const [platform, roots] of candidates) {
    for (const root of roots) {
      const key = path.resolve(root).toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      if (await isValidInstall(root)) found.push({ platform, root: path.resolve(root) })
    }
  }
  return found
}

/** Accepte la racine du jeu ou n'importe quel sous-dossier (TAGame, CookedPCConsole, Binaries…). */
export async function resolveInstallFolder(folder: string): Promise<GameInstall | null> {
  let dir = path.resolve(folder)
  for (let i = 0; i < 4; i++) {
    if (await isValidInstall(dir)) {
      const lower = dir.toLowerCase()
      const platform: Platform = lower.includes('steamapps') ? 'steam' : lower.includes('epic') ? 'epic' : 'custom'
      return { platform, root: dir }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}
