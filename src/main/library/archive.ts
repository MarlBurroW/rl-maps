import { createWriteStream } from 'node:fs'
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import yauzl from 'yauzl'
import { WORKSHOP_TEXTURE_PACKAGES } from '../../shared/compat'
import { t } from '../../shared/i18n'

export const MAP_EXTS = ['.upk', '.udk']
export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.jfif', '.webp']
const KEEP_EXTS = [...MAP_EXTS, ...IMAGE_EXTS, '.json']

/** Copie les fichiers utiles d'un item Steam. Ne déplace ni ne modifie son contenu d'origine. */
export async function copyWorkshopDirectory(source: string, dest: string): Promise<ExtractedFile[]> {
  const files: ExtractedFile[] = []
  const used = new Set<string>()
  const walk = async (dir: string, depth: number) => {
    if (depth > 12) throw new Error(t('Arborescence Workshop trop profonde.'))
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const original = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(original, depth + 1)
      else if (entry.isFile() && KEEP_EXTS.includes(path.extname(entry.name).toLowerCase())) {
        // Renommer un paquet Unreal casserait ses références : rejeter les collisions.
        if (used.has(entry.name.toLowerCase())) throw new Error(t('Deux fichiers Workshop portent le même nom : {name}', { name: entry.name }))
        used.add(entry.name.toLowerCase())
        const target = path.join(dest, entry.name)
        await copyFile(original, target)
        files.push({ path: target, name: entry.name, size: (await stat(target)).size })
      }
    }
  }
  await walk(source, 0)
  return files
}

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
    const reject = (err: unknown) => fail(new Error(t('Archive invalide ou corrompue : {msg}', { msg: String((err as Error)?.message ?? err) })))
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, async (err, zip) => {
      if (err || !zip) return reject(err ?? new Error(t('Archive illisible')))
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
