// Inventaire des paquets présents dans le jeu, pour savoir quelles dépendances d'une map manquent.

import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { cookedDir } from './slot'

const PACKAGE_EXT = /\.(upk|u|udk)$/i
const cache = new Map<string, Promise<Set<string>>>()

async function scan(root: string): Promise<Set<string>> {
  const files = await readdir(cookedDir(root), { recursive: true })
  const names = new Set<string>()
  for (const f of files) {
    if (PACKAGE_EXT.test(f)) names.add(path.basename(f).replace(PACKAGE_EXT, '').toLowerCase())
  }
  return names
}

/** Noms (en minuscules) des paquets du jeu. Le résultat est gardé en mémoire ; `refresh` relit le disque. */
export function gamePackages(root: string, refresh = false): Promise<Set<string>> {
  let entry = cache.get(root)
  if (!entry || refresh) {
    entry = scan(root).catch((err) => {
      cache.delete(root)
      throw err
    })
    cache.set(root, entry)
  }
  return entry
}
