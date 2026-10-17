// Lit à distance les dépendances (paquets importés) de chaque map, sans télécharger les fichiers :
// requêtes HTTP partielles sur le répertoire central du zip, puis sur le début de la map,
// décompressé à la volée jusqu'à la fin de l'en-tête UE3.
// L'app compare ensuite ces dépendances aux fichiers du jeu de l'utilisateur.

import zlib from 'node:zlib'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parsePackage } from '../../src/main/game/upk.ts'
import { WORKSHOP_TEXTURE_PACKAGES } from '../../src/shared/workshop.ts'
import { get, pool, SOURCES_DIR } from './lib.mjs'

const MAP_EXT = /\.(udk|upk)$/i

export function directUrl(url) {
  const id = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/)?.[1]
  return id ? `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t` : url
}

async function range(url, start, end) {
  const res = await get(url, { headers: { range: `bytes=${start}-${end}` } })
  if (res.status !== 206) {
    await res.body?.cancel()
    throw new Error(res.ok ? 'requêtes partielles non supportées' : `HTTP ${res.status}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

/** Entrées du zip (nom, méthode, tailles, offset) lues dans le répertoire central. */
export async function zipEntries(url, size) {
  const tailSize = Math.min(size, 65536)
  let buf = await range(url, size - tailSize, size - 1)
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) throw new Error('zip illisible')
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  let p = cdOffset - (size - tailSize)
  if (p < 0) {
    buf = await range(url, cdOffset, cdOffset + cdSize - 1)
    p = 0
  }
  const entries = []
  while (buf.readUInt32LE(p) === 0x02014b50) {
    const n = buf.readUInt16LE(p + 28)
    entries.push({
      name: buf.toString('utf8', p + 46, p + 46 + n),
      method: buf.readUInt16LE(p + 10),
      csize: buf.readUInt32LE(p + 20),
      usize: buf.readUInt32LE(p + 24),
      offset: buf.readUInt32LE(p + 42)
    })
    p += 46 + n + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32)
  }
  return entries
}

/** Lit l'en-tête UE3 (TotalHeaderSize octets) d'une map, stockée ou compressée dans le zip. */
export async function headerFromZip(url, entry) {
  const local = await range(url, entry.offset, entry.offset + 29)
  const start = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28)
  if (entry.method === 0) return headerFromRaw(url, start)

  for (let want = 256 * 1024; ; want *= 4) {
    const raw = await range(url, start, start + Math.min(entry.csize, want) - 1)
    const out = zlib.inflateRawSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH })
    const headerSize = out.length >= 12 ? out.readInt32LE(8) : Infinity
    if (out.length >= headerSize) return out.subarray(0, headerSize)
    if (want >= entry.csize) throw new Error('en-tête incomplet')
  }
}

async function headerFromRaw(url, start) {
  const first = await range(url, start, start + 63)
  const headerSize = first.readInt32LE(8)
  if (first.readUInt32LE(0) !== 0x9e2a83c1 || headerSize <= 0 || headerSize > 64 * 1024 * 1024) throw new Error('pas un paquet UE3')
  return range(url, start, start + headerSize - 1)
}

export const packageName = (file) => path.basename(file).replace(/\.[^.]+$/, '').toLowerCase()

/** Même choix que l'app (src/main/library/archive.ts) : le plus gros paquet hors pack de textures. */
export function pickMainPackage(entries) {
  const sorted = [...entries].sort((a, b) => b.usize - a.usize)
  return sorted.find((e) => !WORKSHOP_TEXTURE_PACKAGES.has(packageName(e.name))) ?? sorted[0]
}

/**
 * Comme l'app : parmi les paquets hors pack de textures, le plus gros qui contient un niveau
 * (les autres sont des paquets d'assets). Renvoie aussi son en-tête, déjà lu.
 */
export async function findMainPackage(url, entries) {
  const candidates = entries.filter((e) => !WORKSHOP_TEXTURE_PACKAGES.has(packageName(e.name))).sort((a, b) => b.usize - a.usize)
  const fallback = pickMainPackage(entries)
  if (candidates.length <= 1) return { entry: fallback, header: await headerFromZip(url, fallback) }
  for (const entry of candidates) {
    const header = await headerFromZip(url, entry).catch(() => null)
    if (header && parsePackage(header)?.isLevel) return { entry, header }
  }
  return { entry: fallback, header: await headerFromZip(url, fallback) }
}

export class NotAMapError extends Error {}

/** Dépendances d'une entrée de registre, ou null si illisible. */
export async function scanImports(download) {
  const url = directUrl(download.url)
  const name = download.filename ?? ''
  let header
  let bundled = new Set()
  if (/\.zip$/i.test(name)) {
    const maps = (await zipEntries(url, download.size)).filter((e) => MAP_EXT.test(e.name))
    if (!maps.length) return null
    // Que des paquets du pack de textures : ce n'est pas une map
    if (maps.every((e) => WORKSHOP_TEXTURE_PACKAGES.has(packageName(e.name)))) throw new NotAMapError()
    const { entry: main, header: mainHeader } = await findMainPackage(url, maps)
    header = mainHeader
    // Les paquets livrés dans le même zip (niveaux secondaires, assets…) sont copiés avec la map
    bundled = new Set(maps.filter((e) => e !== main).map((e) => packageName(e.name)))
  } else {
    header = await headerFromRaw(url, 0)
  }
  const imports = parsePackage(header)?.imports ?? null
  return imports && imports.filter((p) => !bundled.has(p.toLowerCase()))
}

/**
 * Ajoute `imports` à chaque map. Les résultats du registre existant sont réutilisés tant que
 * le fichier n'a pas changé (même URL et même taille) : seules les nouveautés sont analysées.
 */
export async function withImports(sourceId, maps) {
  const previous = new Map()
  try {
    const old = JSON.parse(await readFile(path.join(SOURCES_DIR, `${sourceId}.json`), 'utf8'))
    for (const m of old.maps) if (m.imports !== undefined) previous.set(`${m.download.url}|${m.download.size}`, m.imports)
  } catch {
    /* premier import */
  }

  let scanned = 0
  let failed = 0
  await pool(maps, 6, async (m) => {
    const key = `${m.download.url}|${m.download.size}`
    if (previous.has(key)) {
      m.imports = previous.get(key)
      return
    }
    try {
      m.imports = await scanImports(m.download)
    } catch (err) {
      if (err instanceof NotAMapError) m.notAMap = true
      else failed++
      m.imports = null
    }
    scanned++
  })
  const notMaps = maps.filter((m) => m.notAMap)
  if (notMaps.length) console.log(`Exclues (pack de textures, pas une map) : ${notMaps.map((m) => m.name).join(', ')}`)
  console.log(`Dépendances : ${scanned} maps analysées (${failed} illisibles), ${maps.length - scanned} reprises du registre`)
  return maps.filter((m) => !m.notAMap)
}
