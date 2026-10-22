import { lstat, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { steamLibraries } from '../game/detect'
import { validWorkshopId } from './steam-api'

export interface LocalWorkshopItem { folder: string; revision: string }

/** Lecture des révisions installées, sans confondre les métadonnées de la version en attente. */
export function installedWorkshopRevisions(vdf: string): Map<string, string> {
  const tokens = [...vdf.matchAll(/"((?:\\.|[^"\\])*)"|([{}])/g)].map((m) => m[2] ?? m[1])
  const revisions = new Map<string, string>()
  const section = tokens.indexOf('WorkshopItemsInstalled')
  if (section < 0 || tokens[section + 1] !== '{') return revisions
  let depth = 1
  let id = ''
  for (let i = section + 2; i < tokens.length && depth > 0; i++) {
    const token = tokens[i]
    if (token === '{') depth++
    else if (token === '}') depth--
    else if (depth === 1 && validWorkshopId(token) && tokens[i + 1] === '{') id = token
    else if (depth === 2 && token === 'timeupdated' && /^\d+$/.test(tokens[i + 1] ?? '')) revisions.set(id, tokens[++i])
  }
  return revisions
}

export async function hasWorkshopMap(dir: string, depth = 0): Promise<boolean> {
  if (depth > 12) return false
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    if (entry.isFile() && /\.(udk|upk)$/i.test(entry.name)) return true
    if (entry.isDirectory() && await hasWorkshopMap(path.join(dir, entry.name), depth + 1)) return true
  }
  return false
}

export async function localWorkshopItems(roots?: string[]): Promise<Map<string, LocalWorkshopItem>> {
  const items = new Map<string, LocalWorkshopItem>()
  for (const root of roots ?? await steamLibraries()) {
    const workshop = path.join(root, 'steamapps', 'workshop')
    let revisions = new Map<string, string>()
    try { revisions = installedWorkshopRevisions(await readFile(path.join(workshop, 'appworkshop_252950.acf'), 'utf8')) } catch { /* Ancien cache Steam. */ }
    const dir = path.join(workshop, 'content', '252950')
    try {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !validWorkshopId(entry.name)) continue
        const folder = path.join(dir, entry.name)
        try {
          if ((await lstat(folder)).isSymbolicLink() || !(await stat(folder)).isDirectory() || !await hasWorkshopMap(folder)) continue
          const item = { folder, revision: revisions.get(entry.name) ?? 'unknown' }
          const previous = items.get(entry.name)
          if (!previous || Number(item.revision) > (Number(previous.revision) || 0)) items.set(entry.name, item)
        } catch { /* Un téléchargement peut être déplacé pendant la lecture. */ }
      }
    } catch { /* Bibliothèque sans maps Workshop. */ }
  }
  return items
}

export function isCurrentLocal(item: LocalWorkshopItem | undefined, revision: string): item is LocalWorkshopItem {
  return !!item && (item.revision === 'unknown' || revision === 'unknown' || Number(item.revision) >= Number(revision))
}
