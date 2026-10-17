// Les « slots » : des arènes Labs jouables en Free Play dont on remplace le fichier par la map custom.
// L'original est gardé à côté en .bak, même convention que les loaders existants
// (marzeq/rl-map-loader, nikosleft/rl-map-loader), ce qui permet de restaurer un original sauvegardé par l'un d'eux.
//
// Underpass est le slot par défaut. Certaines maps réutilisent pourtant des assets d'Underpass
// (sol, bordures…) : les charger à sa place les priverait de ces assets. On les charge alors dans
// un autre slot. Une seule map custom est chargée à la fois.

import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { SlotId, SlotState } from '../../shared/types'
import { applyOps, type FileOp } from './fsops'

export interface SlotDef {
  id: SlotId
  /** Nom du paquet (et du fichier, sans .upk) */
  pkg: string
  /** Nom de l'arène dans la liste Free Play */
  arena: string
}

/** Par ordre de préférence. Utopia Retro n'est réutilisée par aucune map connue du catalogue. */
export const SLOTS: SlotDef[] = [
  { id: 'underpass', pkg: 'Labs_Underpass_P', arena: 'Underpass' },
  { id: 'utopia', pkg: 'Labs_Utopia_P', arena: 'Utopia Retro' }
]
const DEFAULT_SLOT = SLOTS[0]

export const TARGET_MAP = `${DEFAULT_SLOT.pkg}.upk`
export const BACKUP_SUFFIX = '.bak'

/** Ce qu'on retient de la dernière map chargée par l'app, pour la reconnaître ensuite. */
export interface SlotRecord {
  mapId: string
  mapName: string
  size: number
  /** Absent dans les réglages des versions précédentes : Underpass */
  slot?: SlotId
  /** Paquets annexes copiés dans CookedPCConsole (noms de fichiers), à retirer à la restauration */
  extras?: string[]
}

const slotDef = (id: SlotId | undefined) => SLOTS.find((s) => s.id === id) ?? DEFAULT_SLOT

export const cookedDir = (root: string) => path.join(root, 'TAGame', 'CookedPCConsole')
export const targetPath = (root: string, slot: SlotDef = DEFAULT_SLOT) => path.join(cookedDir(root), `${slot.pkg}.upk`)
export const backupPath = (root: string, slot: SlotDef = DEFAULT_SLOT) => targetPath(root, slot) + BACKUP_SUFFIX

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

async function slotsWithBackup(root: string): Promise<SlotDef[]> {
  const found: SlotDef[] = []
  for (const s of SLOTS) if ((await sizeOf(backupPath(root, s))) !== null) found.push(s)
  return found
}

/**
 * Choisit le slot : le premier dont la map n'utilise pas les assets et qui existe dans le jeu.
 * Sans information sur la map (imports illisibles), on reste sur Underpass.
 */
export async function chooseSlot(root: string, imports: string[] | null): Promise<SlotDef> {
  const used = new Set((imports ?? []).map((p) => p.toLowerCase()))
  for (const s of SLOTS) {
    if (used.has(s.pkg.toLowerCase())) continue
    const present = (await sizeOf(targetPath(root, s))) !== null || (await sizeOf(backupPath(root, s))) !== null
    if (present) return s
  }
  return DEFAULT_SLOT
}

/**
 * Déduit l'état à partir du disque. Renvoie aussi le record à conserver :
 * s'il n'y a plus de backup (vérification Epic/Steam, restauration externe), le record est périmé.
 */
export async function readSlot(
  root: string,
  record: SlotRecord | null
): Promise<{ state: SlotState; record: SlotRecord | null }> {
  const backups = await slotsWithBackup(root)
  if (backups.length === 0) return { state: { kind: 'original' }, record: null }
  if (record) {
    const slot = slotDef(record.slot)
    if (backups.includes(slot) && (await sizeOf(targetPath(root, slot))) === record.size) {
      return {
        state: { kind: 'custom', mapId: record.mapId, mapName: record.mapName, slot: slot.id, arena: slot.arena },
        record
      }
    }
  }
  return { state: { kind: 'unknown' }, record: null }
}

/** Opérations qui remettent l'original en place dans chaque slot sauvegardé (sauf `except`). */
async function restoreOps(root: string, except?: SlotDef): Promise<FileOp[]> {
  const ops: FileOp[] = []
  for (const s of await slotsWithBackup(root)) {
    if (s === except) continue
    ops.push({ op: 'copy', from: backupPath(root, s), to: targetPath(root, s) }, { op: 'remove', path: backupPath(root, s) })
  }
  return ops
}

/** Retire les paquets annexes copiés lors du chargement précédent. */
const removeExtrasOps = (root: string, record: SlotRecord | null | undefined): FileOp[] =>
  (record?.extras ?? []).map((name) => ({ op: 'remove', path: path.join(cookedDir(root), path.basename(name)) }))

export interface LoadOptions {
  /** Paquets annexes à copier à côté du slot (déjà filtrés : jamais un fichier du jeu) */
  extras?: { name: string; path: string }[]
  /** Map chargée jusqu'ici, dont on retire les paquets annexes */
  previous?: SlotRecord | null
}

/**
 * Charge une map dans le slot donné. Sauvegarde l'original au premier chargement uniquement,
 * et libère les autres slots : une seule map custom à la fois.
 */
export async function loadIntoSlot(
  root: string,
  mapFile: string,
  map: { id: string; name: string },
  slot: SlotDef = DEFAULT_SLOT,
  opts: LoadOptions = {}
): Promise<SlotRecord> {
  const target = targetPath(root, slot)
  const backup = backupPath(root, slot)
  const size = await sizeOf(mapFile)
  if (size === null) throw new Error(`Fichier de map introuvable : ${mapFile}`)

  const ops = [...removeExtrasOps(root, opts.previous), ...(await restoreOps(root, slot))]
  if ((await sizeOf(backup)) === null) {
    if ((await sizeOf(target)) === null) throw new Error(`${slot.pkg}.upk introuvable : le dossier du jeu est-il correct ?`)
    ops.push({ op: 'copy', from: target, to: backup })
  }
  ops.push({ op: 'copy', from: mapFile, to: target })
  const extras = opts.extras ?? []
  for (const e of extras) ops.push({ op: 'copy', from: e.path, to: path.join(cookedDir(root), path.basename(e.name)) })
  await applyOps(ops)
  return { mapId: map.id, mapName: map.name, size, slot: slot.id, ...(extras.length ? { extras: extras.map((e) => e.name) } : {}) }
}

/** Remet les fichiers d'origine en place dans tous les slots, supprime les backups et les paquets annexes. */
export async function restoreSlot(root: string, record?: SlotRecord | null): Promise<void> {
  const ops = [...removeExtrasOps(root, record), ...(await restoreOps(root))]
  if (ops.length) await applyOps(ops)
}

/**
 * Paquets annexes réellement copiables : on ne remplace jamais un fichier du jeu. Ceux du chargement
 * précédent seront retirés juste avant, ils ne comptent pas comme présents.
 */
export function selectExtras(
  extras: { name: string; path: string }[],
  present: Set<string>,
  previous: SlotRecord | null | undefined
): { name: string; path: string }[] {
  const base = (f: string) => path.parse(f).name.toLowerCase()
  const replaced = new Set((previous?.extras ?? []).map(base))
  return extras.filter((e) => !present.has(base(e.name)) || replaced.has(base(e.name)))
}
