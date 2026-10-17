// Bibliothèque locale : un dossier par map, avec meta.json + fichier de map + miniature.
//   <userData>/library/<id>/meta.json
//   <userData>/library/<id>/<Map>.udk
//   <userData>/library/<id>/thumb.jpg

import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import type { LibraryMap } from '../../shared/types'
import { extractZip, IMAGE_EXTS, MAP_EXTS, pickContent } from './archive'
import { readPackageImports } from '../game/upk'

export const THUMB_PROTOCOL = 'rlmaps'

interface StoredMeta extends Omit<LibraryMap, 'thumbnail'> {
  thumbFile?: string
  remoteThumbnail?: string | null
}

export interface ImportHints {
  registryId?: string
  name?: string
  author?: string
  description?: string
  recommendedSettings?: string
  tags?: string[]
  homepage?: string
  /** Miniature déjà téléchargée (prioritaire sur celle du zip) */
  thumbnailFile?: string
  remoteThumbnail?: string | null
}

export const SUPPORTED_IMPORT_EXTS = [...MAP_EXTS, '.zip']

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'map'

/** Nom lisible à partir d'un nom de fichier : "LethAbstract3.udk" -> "LethAbstract3" */
const prettyName = (file: string) => path.parse(file).name.replace(/[_]+/g, ' ').trim()

export class Library {
  constructor(readonly dir: string) {}

  private mapDir(id: string) {
    // Les ids viennent du registre ou de slug() : on refuse tout ce qui sortirait du dossier.
    if (!/^[\w.-]+$/.test(id) || id.startsWith('.')) throw new Error(`Identifiant de map invalide : ${id}`)
    return path.join(this.dir, id)
  }

  private toPublic(meta: StoredMeta): LibraryMap {
    const { thumbFile, remoteThumbnail, ...rest } = meta
    return {
      ...rest,
      thumbnail: thumbFile
        ? `${THUMB_PROTOCOL}://library/${encodeURIComponent(meta.id)}/${encodeURIComponent(thumbFile)}`
        : (remoteThumbnail ?? null)
    }
  }

  private async readMeta(id: string): Promise<StoredMeta | null> {
    let meta: StoredMeta
    try {
      meta = JSON.parse(await readFile(path.join(this.mapDir(id), 'meta.json'), 'utf8')) as StoredMeta
    } catch {
      return null
    }
    // Maps installées avant l'analyse des dépendances : on la fait une fois et on l'enregistre
    if (meta.imports === undefined) {
      meta.imports = await readPackageImports(path.join(this.mapDir(id), meta.file))
      await writeFile(path.join(this.mapDir(id), 'meta.json'), JSON.stringify(meta, null, 2)).catch(() => {})
    }
    return meta
  }

  async list(): Promise<LibraryMap[]> {
    await mkdir(this.dir, { recursive: true })
    const entries = await readdir(this.dir, { withFileTypes: true })
    const metas = await Promise.all(
      entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => this.readMeta(e.name))
    )
    return metas
      .filter((m): m is StoredMeta => m !== null)
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
      .map((m) => this.toPublic(m))
  }

  async get(id: string): Promise<LibraryMap | null> {
    const meta = await this.readMeta(id)
    return meta ? this.toPublic(meta) : null
  }

  /** Chemin absolu du fichier de map, pour le copier dans le jeu. */
  async mapFile(id: string): Promise<string> {
    const meta = await this.readMeta(id)
    if (!meta) throw new Error('Map introuvable dans la bibliothèque')
    return path.join(this.mapDir(id), meta.file)
  }

  /** Résout une URL rlmaps://library/<id>/<fichier> vers un fichier de la bibliothèque. */
  resolveThumb(id: string, file: string): string | null {
    if (!IMAGE_EXTS.includes(path.extname(file).toLowerCase()) || file !== path.basename(file)) return null
    return path.join(this.mapDir(id), file)
  }

  async remove(id: string): Promise<void> {
    await rm(this.mapDir(id), { recursive: true, force: true })
  }

  /** Importe un .upk/.udk ou un .zip contenant une map. */
  async import(source: string, hints: ImportHints = {}): Promise<LibraryMap> {
    const ext = path.extname(source).toLowerCase()
    if (!SUPPORTED_IMPORT_EXTS.includes(ext)) {
      throw new Error(`Format non supporté (${ext || 'sans extension'}) : utilise un .upk, .udk ou .zip`)
    }
    await mkdir(this.dir, { recursive: true })
    const staging = path.join(this.dir, `.staging-${randomBytes(4).toString('hex')}`)
    await mkdir(staging, { recursive: true })

    try {
      let mapPath: string
      let thumbPath: string | null = null
      let info: { title?: string; author?: string; desc?: string; description?: string } = {}

      if (ext === '.zip') {
        const content = pickContent(await extractZip(source, staging))
        if (!content.map) throw new Error("Aucun fichier .upk ou .udk trouvé dans l'archive")
        mapPath = content.map.path
        thumbPath = content.thumbnail?.path ?? null
        if (content.info) info = JSON.parse(await readFile(content.info.path, 'utf8').catch(() => '{}'))
      } else {
        mapPath = path.join(staging, path.basename(source))
        await copyFile(source, mapPath)
      }
      if (hints.thumbnailFile) thumbPath = hints.thumbnailFile

      // info.json des maps Lethamyr : { author, desc } où desc est en fait le titre court
      const infoTitle = info.title ?? (info.desc && info.desc.length <= 60 ? info.desc : undefined)
      const name =
        hints.name ?? infoTitle ?? (ext === '.zip' ? prettyName(source) : prettyName(mapPath))

      const id = hints.registryId ?? `${slug(name)}-${randomBytes(3).toString('hex')}`
      const finalDir = this.mapDir(id)
      await rm(finalDir, { recursive: true, force: true })
      await mkdir(finalDir, { recursive: true })

      const file = path.basename(mapPath)
      await rename(mapPath, path.join(finalDir, file))
      let thumbFile: string | undefined
      if (thumbPath) {
        thumbFile = `thumb${path.extname(thumbPath).toLowerCase()}`
        await copyFile(thumbPath, path.join(finalDir, thumbFile))
      }

      const meta: StoredMeta = {
        id,
        name,
        author: hints.author ?? info.author,
        description: hints.description ?? info.description,
        recommendedSettings: hints.recommendedSettings,
        tags: hints.tags ?? [],
        file,
        size: (await stat(path.join(finalDir, file))).size,
        registryId: hints.registryId,
        homepage: hints.homepage,
        addedAt: new Date().toISOString(),
        thumbFile,
        remoteThumbnail: hints.remoteThumbnail,
        imports: await readPackageImports(path.join(finalDir, file))
      }
      await writeFile(path.join(finalDir, 'meta.json'), JSON.stringify(meta, null, 2))
      return this.toPublic(meta)
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }
}
