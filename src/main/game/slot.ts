// Le « slot » : Rocket League charge Labs_Underpass_P.upk quand on choisit l'arène Underpass
// en Free Play. On remplace ce fichier par la map custom et on garde l'original à côté en .bak.
// Même convention que les loaders existants (marzeq/rl-map-loader, nikosleft/rl-map-loader),
// ce qui permet de restaurer un original sauvegardé par l'un d'eux.

import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { SlotState } from '../../shared/types'
import { applyOps, type FileOp } from './fsops'

export const TARGET_MAP = 'Labs_Underpass_P.upk'
export const BACKUP_SUFFIX = '.bak'

/** Ce qu'on retient de la dernière map chargée par l'app, pour la reconnaître ensuite. */
export interface SlotRecord {
  mapId: string
  mapName: string
  size: number
}

export const cookedDir = (root: string) => path.join(root, 'TAGame', 'CookedPCConsole')
export const targetPath = (root: string) => path.join(cookedDir(root), TARGET_MAP)
export const backupPath = (root: string) => targetPath(root) + BACKUP_SUFFIX

async function sizeOf(file: string): Promise<number | null> {
  try {
    return (await stat(file)).size
  } catch {
    return null
  }
}

export async function isValidInstall(root: string): Promise<boolean> {
  return (await sizeOf(targetPath(root))) !== null || (await sizeOf(backupPath(root))) !== null
}

/**
 * Déduit l'état du slot à partir du disque. Renvoie aussi le record à conserver :
 * s'il n'y a plus de backup (vérification Epic/Steam, restauration externe), le record est périmé.
 */
export async function readSlot(
  root: string,
  record: SlotRecord | null
): Promise<{ state: SlotState; record: SlotRecord | null }> {
  if ((await sizeOf(backupPath(root))) === null) return { state: { kind: 'original' }, record: null }
  if (record && (await sizeOf(targetPath(root))) === record.size) {
    return { state: { kind: 'custom', mapId: record.mapId, mapName: record.mapName }, record }
  }
  return { state: { kind: 'unknown' }, record: null }
}

/** Charge une map dans le slot. Sauvegarde l'original au premier chargement uniquement. */
export async function loadIntoSlot(
  root: string,
  mapFile: string,
  map: { id: string; name: string }
): Promise<SlotRecord> {
  const target = targetPath(root)
  const backup = backupPath(root)
  const size = await sizeOf(mapFile)
  if (size === null) throw new Error(`Fichier de map introuvable : ${mapFile}`)

  const ops: FileOp[] = []
  if ((await sizeOf(backup)) === null) {
    if ((await sizeOf(target)) === null) throw new Error(`${TARGET_MAP} introuvable : le dossier du jeu est-il correct ?`)
    ops.push({ op: 'copy', from: target, to: backup })
  }
  ops.push({ op: 'copy', from: mapFile, to: target })
  await applyOps(ops)
  return { mapId: map.id, mapName: map.name, size }
}

/** Remet le fichier d'origine en place et supprime le backup. */
export async function restoreSlot(root: string): Promise<void> {
  const backup = backupPath(root)
  if ((await sizeOf(backup)) === null) return
  await applyOps([
    { op: 'copy', from: backup, to: targetPath(root) },
    { op: 'remove', path: backup }
  ])
}
