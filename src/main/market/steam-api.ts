import type { RegistryIndex, RegistryMap } from '../../shared/types'
import { t } from '../../shared/i18n'

export const STEAM_APP_ID = 252950
export const STEAM_SOURCE = { id: 'steam-workshop', name: 'Steam Workshop', url: 'https://steamcommunity.com/app/252950/workshop/', enabled: true }
const API = 'https://api.steampowered.com/'
export const validWorkshopId = (id: unknown): id is string => typeof id === 'string' && /^[1-9]\d{0,19}$/.test(id)

interface PublishedFile {
  publishedfileid: string
  consumer_app_id?: number
  consumer_appid?: number
  result?: number
  file_type?: number
  visibility?: number
  banned?: boolean
  title: string
  creator: string
  description?: string
  file_description?: string
  short_description?: string
  preview_url?: string
  file_url?: string
  filename?: string
  file_size?: string | number
  time_updated?: number
  tags?: { tag: string }[]
}

interface SteamResponse {
  response?: {
    result?: number
    publishedfiledetails?: PublishedFile[]
    next_cursor?: string
    total?: number
    players?: { steamid: string; personaname: string }[]
  }
}

const https = (value: unknown) => {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return undefined
  try { return new URL(value.replace(/^http:/i, 'https:')).href } catch { return undefined }
}

/** Le texte reste du texte : aucun HTML provenant du Workshop n'est exécuté. */
export const workshopText = (text: string) => text
  .replace(/\[url=[^\]]+\]([\s\S]*?)\[\/url\]/gi, '$1')
  .replace(/\[\/?(?:h[1-6]|b|i|u|strike|list|olist|\*|quote|code|img|url|table|tr|td|th|spoiler)(?:=[^\]]*)?\]/gi, '')
  .trim()

export function workshopMap(file: PublishedFile, author = file?.creator): RegistryMap | null {
  if (!file || !validWorkshopId(file.publishedfileid) || (file.consumer_appid ?? file.consumer_app_id) !== STEAM_APP_ID ||
      (file.result !== undefined && file.result !== 1) || (file.file_type !== undefined && file.file_type !== 0) ||
      (file.visibility !== undefined && file.visibility !== 0) || file.banned || typeof file.title !== 'string') return null
  const desc = file.description ?? file.file_description ?? file.short_description ?? ''
  const description = workshopText(typeof desc === 'string' ? desc : '')
  const revision = Number.isSafeInteger(file.time_updated) ? String(file.time_updated) : 'unknown'
  const size = Number(file.file_size)
  return {
    id: `steam-${file.publishedfileid}`, name: file.title, author: author || t('Auteur inconnu'),
    description, summary: description.replace(/\s+/g, ' ').slice(0, 180),
    tags: (Array.isArray(file.tags) ? file.tags : []).map((x) => x?.tag).filter((x): x is string => typeof x === 'string'),
    thumbnail: https(file.preview_url), homepage: `https://steamcommunity.com/sharedfiles/filedetails/?id=${file.publishedfileid}`,
    source: STEAM_SOURCE.id, imports: null,
    download: { url: https(file.file_url), filename: file.filename || undefined, size: size > 0 ? size : null,
      workshop: { id: file.publishedfileid, revision } }
  }
}

export class SteamApi {
  constructor(private fetcher: typeof fetch = fetch) {}

  private async request(endpoint: string, key: string, input: Record<string, unknown>, signal?: AbortSignal) {
    const url = new URL(endpoint, API)
    url.searchParams.set('key', key)
    if (endpoint.startsWith('ISteamUser/')) {
      for (const [name, value] of Object.entries(input)) url.searchParams.set(name, String(value))
    } else url.searchParams.set('input_json', JSON.stringify(input))
    let res: Response
    try {
      res = await this.fetcher(url, { redirect: 'error', signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) })
    } catch {
      signal?.throwIfAborted()
      // Ne jamais propager une erreur fetch qui pourrait contenir l'URL avec la clé.
      throw new Error(t('Steam est injoignable. Réessaie plus tard.'))
    }
    if (res.status === 401 || res.status === 403) throw new Error(t('Clé API Steam refusée. Vérifie la clé dans les réglages.'))
    if (res.status === 429) throw new Error(t('Limite de requêtes Steam atteinte. Réessaie plus tard.'))
    if (!res.ok) throw new Error(t('Erreur Steam (HTTP {status})', { status: res.status }))
    try { return await res.json() as SteamResponse } catch { throw new Error(t('Réponse Steam invalide.')) }
  }

  async page(key: string, cursor: string, signal?: AbortSignal) {
    const data = await this.request('IPublishedFileService/QueryFiles/v1/', key, {
      appid: STEAM_APP_ID, query_type: 1, cursor, numperpage: 100, filetype: 0,
      return_details: true, return_tags: true, return_short_description: false, strip_description_bbcode: true
    }, signal)
    const response = data?.response
    if (!response || (response.result !== undefined && response.result !== 1) ||
        (!Array.isArray(response.publishedfiledetails) && response.total !== 0)) {
      throw new Error(t('Réponse Steam invalide.'))
    }
    response.publishedfiledetails ??= []
    return response as { publishedfiledetails: PublishedFile[]; next_cursor?: string; total?: number }
  }

  async catalog(key: string, signal?: AbortSignal): Promise<RegistryIndex> {
    const files = new Map<string, PublishedFile>()
    const seen = new Set<string>()
    let cursor = '*'
    const cursors = new Set<string>()
    // Seul un catalogue entièrement parcouru remplace le cache précédent.
    for (;;) {
      signal?.throwIfAborted()
      if (cursors.has(cursor) || cursors.size >= 10_000) throw new Error(t('Pagination Steam interrompue. Le catalogue précédent est conservé.'))
      cursors.add(cursor)
      const page = await this.page(key, cursor, signal)
      for (const item of page.publishedfiledetails) {
        if (item?.publishedfileid) seen.add(item.publishedfileid)
        if (workshopMap(item)) files.set(item.publishedfileid, item)
      }
      if (typeof page.total === 'number' && seen.size >= page.total) break
      if (!page.publishedfiledetails.length || !page.next_cursor) {
        if (typeof page.total === 'number' && seen.size < page.total) throw new Error(t('Pagination Steam interrompue. Le catalogue précédent est conservé.'))
        break
      }
      cursor = page.next_cursor
    }
    const authors = new Map<string, string>()
    const ids = [...new Set([...files.values()].map((f) => f.creator).filter((id) => /^\d{17}$/.test(id)))]
    for (let i = 0; i < ids.length; i += 100) {
      signal?.throwIfAborted()
      try {
        const data = await this.request('ISteamUser/GetPlayerSummaries/v2/', key, { steamids: ids.slice(i, i + 100).join(',') }, signal)
        for (const p of data?.response?.players ?? []) {
          if (typeof p.steamid === 'string' && typeof p.personaname === 'string') authors.set(p.steamid, p.personaname)
        }
      } catch {
        signal?.throwIfAborted()
        break // Ne pas répéter les appels en échec : les SteamID restent exploitables.
      }
    }
    return { version: 1, name: STEAM_SOURCE.name, updatedAt: new Date().toISOString(),
      maps: [...files.values()].map((f) => workshopMap(f, authors.get(f.creator) ?? f.creator)!) }
  }
}
