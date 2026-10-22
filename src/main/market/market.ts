// Agrège les registres de maps configurés.
// Ordre de repli pour chaque source : réseau -> cache local -> copie embarquée (sources intégrées).
// Une même map publiée dans plusieurs registres n'apparaît qu'une fois : la première source
// fournit la fiche, les autres ajoutent leurs liens comme miroirs de téléchargement.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { MarketMap, MarketState, RegistryIndex, RegistryMap, RegistrySource } from '../../shared/types'
import { BUILTIN_SOURCE_IDS } from '../../shared/config'
import { t } from '../../shared/i18n'
import { downloadUrls } from '../../shared/updates'

export interface SourceResult {
  source: RegistrySource
  index: RegistryIndex | null
  origin: 'live' | 'cache' | 'bundled' | 'error'
  error?: string
}

const TTL_MS = 30 * 60 * 1000
const isHttps = (u: unknown): u is string => typeof u === 'string' && /^https:\/\//.test(u)

/** Validation légère : on garde les entrées exploitables, on ignore le reste sans tout rejeter. */
export function parseRegistry(raw: unknown, allowWorkshop = false): RegistryIndex {
  const data = raw as Partial<RegistryIndex>
  if (!data || typeof data !== 'object' || !Array.isArray(data.maps)) throw new Error(t('Registre invalide : champ « maps » manquant'))
  const maps = data.maps.filter(
    (m): m is RegistryMap =>
      !!m && typeof m.id === 'string' && /^[\w.-]+$/.test(m.id) && typeof m.name === 'string' &&
      (isHttps(m.download?.url) || (allowWorkshop && /^[1-9]\d{0,19}$/.test(m.download?.workshop?.id ?? '') &&
        typeof m.download?.workshop?.revision === 'string'))
  )
  return {
    version: 1,
    name: typeof data.name === 'string' ? data.name : 'Registre',
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    maps: maps.map((m) => ({
      ...m,
      author: typeof m.author === 'string' ? m.author : 'Inconnu',
      tags: Array.isArray(m.tags) ? m.tags.filter((tag) => typeof tag === 'string') : [],
      thumbnail: isHttps(m.thumbnail) ? m.thumbnail : null,
      imports: Array.isArray(m.imports) ? m.imports.filter((p) => typeof p === 'string') : null,
      download: { ...m.download, url: isHttps(m.download.url) ? m.download.url : undefined,
        workshop: allowWorkshop && /^[1-9]\d{0,19}$/.test(m.download.workshop?.id ?? '') &&
          typeof m.download.workshop?.revision === 'string' ? m.download.workshop : undefined,
        mirrors: Array.isArray(m.download.mirrors) ? m.download.mirrors.filter(isHttps) : [] }
    }))
  }
}

const compact = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/** Deux entrées désignent la même map si le titre et l'auteur coïncident (casse, accents et ponctuation ignorés). */
export const mergeKey = (m: Pick<RegistryMap, 'name' | 'author'>) => `${compact(m.name)}|${compact(m.author)}`

/** Synonymes de tags entre registres */
const TAG_ALIASES: Record<string, string> = { 'hide & seek': 'Hide and Seek', 'hide n seek': 'Hide and Seek' }
const canonicalTag = (t: string) => TAG_ALIASES[t.trim().toLowerCase()] ?? t.trim()

/** Fusionne les registres dans l'ordre des sources. */
export function mergeRegistries(entries: { source: RegistrySource; index: RegistryIndex }[]): MarketMap[] {
  const byKey = new Map<string, MarketMap>()
  const byId = new Map<string, MarketMap>()

  for (const { source, index } of entries) {
    for (const m of index.maps) {
      if (byId.has(m.id)) continue // même id dans deux sources : la première l'emporte
      const ref = { id: source.id, name: source.name, homepage: m.homepage }
      const existing = byKey.get(mergeKey(m))
      if (existing) {
        const urls = downloadUrls(existing.download)
        for (const url of downloadUrls(m.download)) if (!urls.includes(url)) urls.push(url)
        existing.download.url = urls[0]
        existing.download.mirrors = urls.slice(1)
        existing.download.workshop ??= m.download.workshop
        existing.registryIds = [...new Set([...(existing.registryIds ?? [existing.id]), m.id])]
        byId.set(m.id, existing)
        existing.download.size ??= m.download.size
        existing.tags = [...new Set([...existing.tags, ...m.tags.map(canonicalTag)])]
        existing.thumbnail ??= m.thumbnail
        existing.description ||= m.description
        existing.recommendedSettings ||= m.recommendedSettings
        existing.imports ??= m.imports
        if (!existing.sources.some((s) => s.id === source.id)) existing.sources.push(ref)
        continue
      }
      const entry: MarketMap = {
        ...m,
        tags: [...new Set(m.tags.map(canonicalTag))],
        download: { ...m.download, mirrors: [...(m.download.mirrors ?? [])] },
        sourceId: source.id,
        registryIds: [m.id],
        sources: [ref]
      }
      byKey.set(mergeKey(m), entry)
      byId.set(m.id, entry)
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export class Market {
  private memory: { at: number; state: MarketState } | null = null
  private generation = 0

  constructor(
    private cacheDir: string,
    /** Dossier des copies embarquées : <id>.json pour chaque source intégrée */
    private bundledDir: string,
    private extraSource?: (refresh: boolean) => Promise<SourceResult | null>
  ) {}

  invalidate() { this.memory = null; this.generation++ }

  private cacheFile(id: string) {
    return path.join(this.cacheDir, `${id.replace(/[^\w-]/g, '_')}.json`)
  }

  private async fromFile(file: string): Promise<RegistryIndex | null> {
    try {
      return parseRegistry(JSON.parse(await readFile(file, 'utf8')))
    } catch {
      return null
    }
  }

  private async fetchSource(source: RegistrySource) {
    try {
      const res = await fetch(source.url, { signal: AbortSignal.timeout(15_000), cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const index = parseRegistry(await res.json())
      await mkdir(this.cacheDir, { recursive: true })
      await writeFile(this.cacheFile(source.id), JSON.stringify(index))
      return { index, origin: 'live' as const }
    } catch (err) {
      const cached = await this.fromFile(this.cacheFile(source.id))
      if (cached) return { index: cached, origin: 'cache' as const }
      if (BUILTIN_SOURCE_IDS.has(source.id)) {
        const bundled = await this.fromFile(path.join(this.bundledDir, `${source.id}.json`))
        if (bundled) return { index: bundled, origin: 'bundled' as const }
      }
      return { index: null, origin: 'error' as const, error: `${source.name} : ${(err as Error).message}` }
    }
  }

  async get(sources: RegistrySource[], refresh = false): Promise<MarketState> {
    if (!refresh && this.memory && Date.now() - this.memory.at < TTL_MS) return this.memory.state

    const enabled = sources.filter((s) => s.enabled)
    const generation = this.generation
    const [results, extra] = await Promise.all([
      Promise.all(enabled.map((s) => this.fetchSource(s))), this.extraSource?.(refresh)
    ])
    const state: MarketState = { maps: [], origin: {}, errors: [] }
    const loaded: { source: RegistrySource; index: RegistryIndex }[] = []

    results.forEach((r, i) => {
      state.origin[enabled[i].id] = r.origin
      if ('error' in r && r.error) state.errors.push(r.error)
      if (r.index) loaded.push({ source: enabled[i], index: r.index })
    })
    if (extra) {
      state.origin[extra.source.id] = extra.origin
      if (extra.error) state.errors.push(extra.error)
      if (extra.index) loaded.push({ source: extra.source, index: extra.index })
    }
    state.maps = mergeRegistries(loaded)
    if (generation !== this.generation) return this.get(sources, true)
    this.memory = { at: Date.now(), state }
    return state
  }

  find(sourceId: string, registryId: string): MarketMap | undefined {
    return this.memory?.state.maps.find((m) => m.sourceId === sourceId && m.id === registryId)
  }
}
