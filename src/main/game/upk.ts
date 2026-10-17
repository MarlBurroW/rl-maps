// Lecture minimale d'un paquet Unreal Engine 3 (.udk/.upk) : on extrait les paquets externes
// dont la map importe des objets (textures, matériaux…). Seul l'en-tête est lu, pas le contenu.

import { open } from 'node:fs/promises'

const PACKAGE_TAG = 0x9e2a83c1
const PKG_STORE_COMPRESSED = 0x02000000
/** Garde-fou : un en-tête de map fait quelques centaines de Ko, jamais des centaines de Mo */
const MAX_HEADER = 64 * 1024 * 1024

// Pas de propriétés de paramètre (`constructor(readonly buf)`) : ce fichier est aussi exécuté
// directement par Node (scripts du registre), qui ne gère que les types effaçables.
class Reader {
  buf: Buffer
  pos: number
  constructor(buf: Buffer, pos = 0) {
    this.buf = buf
    this.pos = pos
  }
  i32() {
    const v = this.buf.readInt32LE(this.pos)
    this.pos += 4
    return v
  }
  u32() {
    const v = this.buf.readUInt32LE(this.pos)
    this.pos += 4
    return v
  }
  u16() {
    const v = this.buf.readUInt16LE(this.pos)
    this.pos += 2
    return v
  }
  /** FString UE3 : longueur positive = ANSI, négative = UTF-16, terminateur nul inclus */
  fstring() {
    const len = this.i32()
    const bytes = len >= 0 ? len : -len * 2
    if (bytes > 4096) throw new Error('Chaîne invalide dans le paquet')
    const raw = this.buf.subarray(this.pos, this.pos + bytes)
    this.pos += bytes
    return (len >= 0 ? raw.toString('latin1') : raw.toString('utf16le')).replace(/\0+$/, '')
  }
}

export interface PackageInfo {
  /** Paquets externes réellement utilisés (racines des objets importés) */
  imports: string[]
  /** Le paquet contient un niveau (objet World) : c'est une map, pas un paquet d'assets */
  isLevel: boolean
}

/**
 * Paquets externes réellement utilisés par la map (racines des objets importés).
 * Renvoie null si le fichier n'est pas un paquet UE3 lisible (chiffré, compressé…).
 */
export async function readPackageImports(file: string): Promise<string[] | null> {
  return (await readPackageInfo(file))?.imports ?? null
}

export async function readPackageInfo(file: string): Promise<PackageInfo | null> {
  const fh = await open(file, 'r')
  try {
    const head = Buffer.alloc(64)
    await fh.read(head, 0, 64, 0)
    if (head.readUInt32LE(0) !== PACKAGE_TAG) return null
    const headerSize = head.readInt32LE(8)
    if (headerSize <= 0 || headerSize > MAX_HEADER) return null

    const buf = Buffer.alloc(headerSize)
    await fh.read(buf, 0, headerSize, 0)
    return parsePackage(buf)
  } catch {
    return null
  } finally {
    await fh.close()
  }
}

export function parseImports(buf: Buffer): string[] | null {
  return parsePackage(buf)?.imports ?? null
}

export function parsePackage(buf: Buffer): PackageInfo | null {
  const r = new Reader(buf, 4)
  r.u16() // version
  r.u16() // licensee
  r.i32() // taille de l'en-tête
  r.fstring() // dossier
  const flags = r.u32()
  if (flags & PKG_STORE_COMPRESSED) return null
  const nameCount = r.i32()
  const nameOffset = r.i32()
  r.i32() // exports
  r.i32()
  const importCount = r.i32()
  const importOffset = r.i32()

  const names: string[] = []
  r.pos = nameOffset
  for (let i = 0; i < nameCount; i++) {
    names.push(r.fstring())
    r.pos += 8 // flags de l'entrée
  }

  // Entrée d'import : ClassPackage, ClassName (FName = index + numéro), Outer, ObjectName
  const imports: { cls: string; outer: number; name: string }[] = []
  r.pos = importOffset
  for (let i = 0; i < importCount; i++) {
    r.pos += 8
    const cls = names[r.i32()]
    r.pos += 4
    const outer = r.i32()
    const name = names[r.i32()]
    r.pos += 4
    if (cls === undefined || name === undefined) return null
    imports.push({ cls, outer, name })
  }

  const root = (i: number) => {
    for (let guard = 0; imports[i]?.outer !== 0 && guard < 64; guard++) i = -imports[i].outer - 1
    return imports[i]?.name
  }
  const used = new Set<string>()
  imports.forEach((imp, i) => {
    if (imp.cls === 'Package') return
    const pkg = root(i)
    if (pkg) used.add(pkg)
  })
  // Un niveau exporte un objet World : sa classe apparaît dans les imports
  const isLevel = imports.some((imp) => imp.cls === 'Class' && imp.name === 'World')
  return { imports: [...used].sort(), isLevel }
}
