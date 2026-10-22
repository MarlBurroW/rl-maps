import type { RegistryMap } from '../../shared/types'
import { open, rename } from 'node:fs/promises'
import path from 'node:path'
import { downloadFingerprint, downloadUrls } from '../../shared/updates'
import { t } from '../../shared/i18n'
import { downloadFirst, type DownloadOptions } from './download'
import { isCurrentLocal, localWorkshopItems } from './steam-local'

/** Résout le fichier à importer, avec repli vers une copie Steam complète et à jour. */
export async function acquireMarketMap(entry: RegistryMap, dir: string, opts: DownloadOptions = {}, roots?: string[]) {
  const urls = downloadUrls(entry.download)
  let failure: unknown
  if (urls.length) {
    try {
      const fallback = entry.download.filename || `${entry.id}.${entry.source === 'steam-workshop' ? 'udk' : 'zip'}`
      let file = await downloadFirst(urls, dir, fallback, opts)
      // Les anciens fichiers UGC sont parfois servis sans nom ni extension.
      if (entry.source === 'steam-workshop') {
        const handle = await open(file, 'r')
        const signature = Buffer.alloc(4)
        try { await handle.read(signature, 0, 4, 0) } finally { await handle.close() }
        const magic = signature.readUInt32LE(0)
        const ext = magic === 0x04034b50 ? '.zip' : magic === 0x9e2a83c1 ? '.udk' : null
        if (!ext) throw new Error(t('Le fichier Workshop reçu ne contient pas une map ou une archive reconnue.'))
        if (!['.udk', '.upk', '.zip'].includes(path.extname(file).toLowerCase()) ||
            (ext === '.zip') !== (path.extname(file).toLowerCase() === '.zip')) {
          const target = path.join(dir, `${entry.id}${ext}`)
          if (file !== target) { await rename(file, target); file = target }
        }
      }
      return { file, workshopDirectory: false, fingerprint: downloadFingerprint(entry.download) }
    } catch (err) { opts.signal?.throwIfAborted(); failure = err }
  }
  const workshop = entry.download.workshop
  if (workshop) {
    opts.signal?.throwIfAborted()
    const local = (await localWorkshopItems(roots)).get(workshop.id)
    if (isCurrentLocal(local, workshop.revision)) {
      return { file: local.folder, workshopDirectory: true, fingerprint: `steam:${workshop.id}|${local.revision}` }
    }
    if (!failure) throw new Error(t('Télécharge ou mets à jour cette map dans Steam, puis actualise le catalogue. La clé API seule ne donne pas accès au fichier.'))
  }
  throw failure ?? new Error(t('Aucun lien de téléchargement'))
}
