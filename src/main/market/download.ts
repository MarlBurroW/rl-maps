import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { t } from '../../shared/i18n'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) RLMaps'

/** Transforme les liens de partage courants en liens de téléchargement direct. */
export function toDirectUrl(url: string): string {
  const u = new URL(url)
  if (u.hostname === 'drive.google.com' || u.hostname === 'drive.usercontent.google.com') {
    const id = u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] ?? u.searchParams.get('id')
    if (id) return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`
  }
  if (u.hostname.endsWith('dropbox.com')) {
    u.searchParams.set('dl', '1')
    return u.href
  }
  return url
}

export function filenameFromResponse(res: Response, fallback: string): string {
  const disposition = res.headers.get('content-disposition') ?? ''
  const star = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1]
  const fromUrl = path.basename(new URL(res.url).pathname)
  const name = (star && decodeURIComponent(star)) || plain || (path.extname(fromUrl) ? fromUrl : fallback)
  return path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
}

export interface DownloadOptions {
  signal?: AbortSignal
  onProgress?: (received: number, total: number | null) => void
}

/** Télécharge `url` dans `dir`, renvoie le chemin du fichier écrit. */
export async function download(url: string, dir: string, fallbackName: string, opts: DownloadOptions = {}) {
  const res = await fetch(toDirectUrl(url), { headers: { 'user-agent': UA }, signal: opts.signal, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(t('Téléchargement impossible (HTTP {status})', { status: res.status }))
  if ((res.headers.get('content-type') ?? '').includes('text/html')) {
    await res.body.cancel()
    throw new Error(
      t("L'hébergeur a renvoyé une page web au lieu du fichier (quota Google Drive dépassé ou lien privé). Réessaie plus tard ou ouvre la page de la map.")
    )
  }

  const total = Number(res.headers.get('content-length')) || null
  const file = path.join(dir, filenameFromResponse(res, fallbackName))
  let received = 0
  let lastEmit = 0
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length
      const now = Date.now()
      if (now - lastEmit > 100) {
        lastEmit = now
        opts.onProgress?.(received, total)
      }
      cb(null, chunk)
    }
  })

  try {
    await pipeline(Readable.fromWeb(res.body as never), meter, createWriteStream(file), { signal: opts.signal })
  } catch (err) {
    await rm(file, { force: true })
    throw err
  }
  opts.onProgress?.(received, total)
  return file
}

/** Essaie chaque lien dans l'ordre (lien principal puis miroirs) et s'arrête au premier qui fonctionne. */
export async function downloadFirst(urls: string[], dir: string, fallbackName: string, opts: DownloadOptions = {}) {
  const errors: string[] = []
  for (const url of urls) {
    try {
      return await download(url, dir, fallbackName, opts)
    } catch (err) {
      if (opts.signal?.aborted) throw err
      errors.push(`${new URL(url).hostname} : ${(err as Error).message}`)
    }
  }
  throw new Error(
    errors.length > 1
      ? t("Aucun des {n} liens n'a fonctionné.", { n: errors.length }) + '\n' + errors.join('\n')
      : (errors[0] ?? t('Aucun lien de téléchargement'))
  )
}
