import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import yauzl from 'yauzl'
import { WORKSHOP_TEXTURE_PACKAGES } from '../../shared/compat'

export const MAP_EXTS = ['.upk', '.udk']
export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.jfif', '.webp']
const KEEP_EXTS = [...MAP_EXTS, ...IMAGE_EXTS, '.json']

export interface ExtractedFile {
  path: string
  name: string
  size: number
}

/**
 * Extrait uniquement les fichiers utiles (maps, images, json) d'un zip, en aplatissant l'arborescence.
 * Les noms d'entrée ne sont jamais utilisés comme chemins, et yauzl rejette déjà les archives
 * contenant des chemins absolus ou en « ../ » : pas de zip-slip possible.
 */
export function extractZip(zipPath: string, destDir: string): Promise<ExtractedFile[]> {
  return new Promise<ExtractedFile[]>((resolve, fail) => {
    const reject = (err: unknown) => fail(new Error(`Archive invalide ou corrompue : ${(err as Error)?.message ?? err}`))
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, async (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Archive illisible'))
      await mkdir(destDir, { recursive: true })
      const out: ExtractedFile[] = []
      const used = new Set<string>()

      zip.on('error', reject)
      zip.on('end', () => resolve(out))
      zip.on('entry', (entry: yauzl.Entry) => {
        const base = path.basename(entry.fileName.replace(/\\/g, '/'))
        const ext = path.extname(base).toLowerCase()
        if (entry.fileName.endsWith('/') || !base || base.startsWith('.') || !KEEP_EXTS.includes(ext)) {
          return zip.readEntry()
        }
        let name = base
        for (let i = 2; used.has(name.toLowerCase()); i++) name = `${path.parse(base).name}-${i}${ext}`
        used.add(name.toLowerCase())

        zip.openReadStream(entry, async (e, stream) => {
          if (e || !stream) return reject(e)
          const target = path.join(destDir, name)
          try {
            await pipeline(stream, createWriteStream(target))
            out.push({ path: target, name, size: entry.uncompressedSize })
            zip.readEntry()
          } catch (pipeErr) {
            zip.close()
            reject(pipeErr)
          }
        })
      })
      zip.readEntry()
    })
  })
}

const byExt = (exts: string[]) => (f: ExtractedFile) => exts.includes(path.extname(f.name).toLowerCase())

/**
 * Choisit la map (le plus gros .udk/.upk qui n'est pas un paquet du pack de textures), ses paquets
 * annexes (niveaux secondaires, assets, textures embarquées…), une miniature et un info.json éventuel.
 */
export function pickContent(files: ExtractedFile[]) {
  const packages = files.filter(byExt(MAP_EXTS)).sort((a, b) => b.size - a.size)
  const isPack = (f: ExtractedFile) => WORKSHOP_TEXTURE_PACKAGES.has(path.parse(f.name).name.toLowerCase())
  const map = packages.find((f) => !isPack(f)) ?? packages[0] ?? null
  const extras = packages.filter((f) => f !== map)
  // Les zips contiennent parfois des captures 4K : on préfère la plus grande image de moins de 4 Mo.
  const images = files.filter(byExt(IMAGE_EXTS)).sort((a, b) => b.size - a.size)
  const thumbnail = images.find((f) => f.size < 4 * 1024 * 1024) ?? images.at(-1) ?? null
  const info = files.find((f) => f.name.toLowerCase() === 'info.json')
  return { map, extras, thumbnail, info: info ?? null }
}
