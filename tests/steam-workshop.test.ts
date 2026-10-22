import { describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { SteamApi, STEAM_SOURCE, workshopMap } from '../src/main/market/steam-api'
import { SteamWorkshop, type KeyProtection } from '../src/main/market/steam-workshop'
import { installedWorkshopRevisions, isCurrentLocal, localWorkshopItems } from '../src/main/market/steam-local'
import { Market, mergeRegistries, parseRegistry } from '../src/main/market/market'
import { acquireMarketMap } from '../src/main/market/acquire'
import { Library } from '../src/main/library/library'
import { downloadFingerprint, isUpToDate } from '../src/shared/updates'
import { loadIntoSlot, readSlot, restoreSlot, targetPath } from '../src/main/game/slot'
import type { RegistryIndex } from '../src/shared/types'
import { fakeInstall, makePackage, makeZip, tempDir } from './helpers'

const key = '1234567890abcdef1234567890abcdef'
// QueryFiles utilise consumer_appid/file_description ; RemoteStorage utilise consumer_app_id/description.
const details = (id = '964271505') => ({ publishedfileid: id, consumer_appid: 252950, result: 1,
  file_type: 0, visibility: 0, title: 'Dribbling Challenge #2', creator: '76561198000000001',
  file_description: '[b]Training[/b]\n[url=https://example.com]Instructions[/url]', file_url: '',
  file_size: '14120891', time_updated: 1555545984, tags: [{ tag: 'Training' }] })
const index = (id = '964271505'): RegistryIndex => ({ version: 1, name: 'Steam Workshop', updatedAt: '', maps: [workshopMap(details(id))!] })
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

function protection(): KeyProtection {
  const secret = randomBytes(32)
  return {
    available: () => true,
    encrypt(value) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', secret, iv)
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
    },
    decrypt(value) {
      const cipher = createDecipheriv('aes-256-gcm', secret, value.subarray(0, 12))
      cipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8')
    }
  }
}

describe('catalogue Steam', () => {
  it.skipIf(!process.env.RLMAPS_NET)('lit les métadonnées réelles de trois maps sans compte ni clé', async () => {
    const ids = ['2025564083', '964271505', '1671658424']
    const body = new URLSearchParams({ itemcount: String(ids.length) })
    ids.forEach((id, i) => body.set(`publishedfileids[${i}]`, id))
    const response = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
      method: 'POST', body, signal: AbortSignal.timeout(25_000)
    })
    expect(response.ok).toBe(true)
    const raw = await response.json() as { response: { publishedfiledetails: Parameters<typeof workshopMap>[0][] } }
    const maps = raw.response.publishedfiledetails.map((file) => workshopMap(file))
    expect(maps.map((m) => m?.id)).toEqual(ids.map((id) => `steam-${id}`))
    expect(maps.every((m) => !!m?.name && !!m.download.workshop)).toBe(true)
  }, 30_000)

  it('parcourt les curseurs, déduplique les IDs et résout les auteurs sans exposer la clé', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input))
      expect(url.origin).toBe('https://api.steampowered.com')
      expect(init?.redirect).toBe('error')
      expect(url.searchParams.get('key')).toBe(key)
      if (url.pathname.includes('GetPlayerSummaries')) {
        expect(url.searchParams.get('steamids')).toBe(details().creator)
        return json({ response: { players: [{ steamid: details().creator, personaname: 'French Fries' }] } })
      }
      const query = JSON.parse(url.searchParams.get('input_json')!)
      expect(query).toMatchObject({ appid: 252950, filetype: 0, numperpage: 100, return_details: true })
      return json({ response: query.cursor === '*'
        ? { total: 3, publishedfiledetails: [details(), { ...details('222'), consumer_appid: 4000 }], next_cursor: 'a+/=' }
        : { total: 3, publishedfiledetails: [details(), details('333')], next_cursor: 'a+/=' } })
    })
    const result = await new SteamApi(fetcher).catalog(key)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(result.maps.map((m) => m.id)).toEqual(['steam-964271505', 'steam-333'])
    expect(result.maps[0]).toMatchObject({ author: 'French Fries', description: 'Training\nInstructions', download: { workshop: { id: '964271505' } } })
    expect(result.maps[0].download.url).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain(key)
  })

  it('ne transforme pas une fiche sans lien en faux téléchargement et ignore collections/maps privées', () => {
    expect(workshopMap(details())?.download.url).toBeUndefined()
    expect(workshopMap({ ...details(), file_type: 2 })).toBeNull()
    expect(workshopMap({ ...details(), visibility: 1 })).toBeNull()
    expect(workshopMap({ ...details(), banned: true })).toBeNull()
    expect(workshopMap({ ...details(), publishedfileid: '../bad' })).toBeNull()
    expect(workshopMap({ ...details(), consumer_appid: undefined, consumer_app_id: 252950 })?.id).toBe('steam-964271505')
    expect(workshopMap({ ...details(), file_url: 'http://cdn.example.com/Map.udk' })?.download.url).toBe('https://cdn.example.com/Map.udk')
    expect(parseRegistry(index()).maps).toEqual([])
    expect(parseRegistry(index(), true).maps).toHaveLength(1)
  })

  it('refuse les pages manquantes et les boucles, au lieu de retourner un catalogue tronqué', async () => {
    const loop = new SteamApi(vi.fn(async () => json({ response: { publishedfiledetails: [details()], next_cursor: '*' } })))
    await expect(loop.catalog(key)).rejects.toThrow(/Pagination/)
    const truncated = new SteamApi(vi.fn(async () => json({ response: { total: 2, publishedfiledetails: [details()] } })))
    await expect(truncated.catalog(key)).rejects.toThrow(/Pagination/)
    const empty = new SteamApi(vi.fn(async () => json({ response: { total: 0 } })))
    expect((await empty.catalog(key)).maps).toEqual([])
  })

  it('explique les refus Steam et ne laisse pas la clé fuiter dans les erreurs réseau', async () => {
    for (const status of [403, 429, 500]) {
      const api = new SteamApi(vi.fn(async () => new Response('', { status })))
      await expect(api.page(key, '*')).rejects.toThrow(status === 403 ? /Clé API/ : status === 429 ? /Limite/ : /500/)
    }
    const api = new SteamApi(vi.fn(async (url) => { throw new Error(String(url)) }))
    await expect(api.page(key, '*')).rejects.toThrow('Steam est injoignable')
    await expect(api.page(key, '*')).rejects.not.toThrow(key)
  })

  it('fusionne avec les liens existants et conserve le secours Workshop dans les deux ordres', () => {
    const steam = index()
    const other = { ...index(), maps: [{ ...steam.maps[0], id: 'other-1', download: { url: 'https://author.example/Map.zip' } }] }
    const external = { id: 'author', name: 'Author', url: 'https://example.com/index.json', enabled: true }
    for (const entries of [
      [{ source: external, index: other }, { source: STEAM_SOURCE, index: steam }],
      [{ source: STEAM_SOURCE, index: steam }, { source: external, index: other }]
    ]) {
      const maps = mergeRegistries(entries)
      expect(maps).toHaveLength(1)
      expect(maps[0].sources).toHaveLength(2)
      expect(maps[0].registryIds?.sort()).toEqual(['other-1', 'steam-964271505'])
      expect(maps[0].download).toMatchObject({ url: 'https://author.example/Map.zip', mirrors: [], workshop: { id: '964271505' } })
    }
  })
})

describe('configuration et cache Steam', () => {
  it('valide, chiffre, recharge et efface la clé sans la renvoyer à l’interface', async () => {
    const dir = await tempDir()
    const cipher = protection()
    const api = new SteamApi()
    const validate = vi.spyOn(api, 'page').mockResolvedValue({ publishedfiledetails: [] })
    const service = new SteamWorkshop(dir, cipher, api)
    await service.load()
    expect(await service.catalog()).toBeNull()
    expect(await service.configure({ apiKey: key, enabled: true })).toEqual({ enabled: true, hasApiKey: true })
    expect(validate).toHaveBeenCalledWith(key, '*')
    expect(await readFile(path.join(dir, 'steam-workshop.json'), 'utf8')).not.toContain(key)
    const reopened = new SteamWorkshop(dir, cipher, api)
    await reopened.load()
    expect(reopened.status()).toEqual({ enabled: true, hasApiKey: true })
    validate.mockRejectedValue(new Error('Steam refuse'))
    await expect(reopened.configure({ apiKey: 'b'.repeat(32) })).rejects.toThrow('Steam refuse')
    expect(reopened.status().hasApiKey).toBe(true)
    expect(await reopened.configure({ apiKey: '' })).toEqual({ enabled: false, hasApiKey: false })
    expect(JSON.parse(await readFile(path.join(dir, 'steam-workshop.json'), 'utf8')).encryptedKey).toBe('')
  })

  it('refuse de stocker une clé sans chiffrement', async () => {
    const cipher = { ...protection(), available: () => false }
    const service = new SteamWorkshop(await tempDir(), cipher)
    await expect(service.configure({ apiKey: key })).rejects.toThrow(/chiffrement/)
    expect(service.status().hasApiKey).toBe(false)
  })

  it('conserve le dernier catalogue complet après une erreur, y compris après redémarrage', async () => {
    const dir = await tempDir()
    const api = new SteamApi()
    const cipher = protection()
    vi.spyOn(api, 'page').mockResolvedValue({ publishedfiledetails: [] })
    const fetchCatalog = vi.spyOn(api, 'catalog').mockResolvedValue(index())
    const service = new SteamWorkshop(dir, cipher, api)
    await service.configure({ apiKey: key, enabled: true })
    expect((await service.catalog())?.origin).toBe('live')
    fetchCatalog.mockRejectedValue(new Error('Steam indisponible'))
    const reopened = new SteamWorkshop(dir, cipher, api)
    await reopened.load()
    const cached = await reopened.catalog(true)
    expect(cached?.origin).toBe('cache')
    expect(cached?.index?.maps).toHaveLength(1)
    expect(cached?.error).toContain('Steam indisponible')
    expect((await readFile(path.join(dir, 'cache', 'steam-workshop.json'), 'utf8'))).not.toContain(key)
  })

  it('intègre la source dynamique et l’invalidation sans conserver les maps après désactivation', async () => {
    const provider = vi.fn(async () => ({ source: STEAM_SOURCE, index: index(), origin: 'live' as const }))
    const dir = await tempDir()
    const market = new Market(dir, dir, provider)
    expect((await market.get([])).maps).toHaveLength(1)
    provider.mockResolvedValue(null as never)
    market.invalidate()
    expect((await market.get([])).maps).toHaveLength(0)
  })
})

describe('installation Workshop pour Epic', () => {
  const manifest = (time: string) => `"AppWorkshop" { "WorkshopItemsInstalled" { "964271505" { "manifest" "123" "timeupdated" "${time}" } } "WorkshopItemDetails" { "964271505" { "timeupdated" "9999999999" } } }`

  async function fixture() {
    const root = await tempDir()
    const workshop = path.join(root, 'steamapps', 'workshop')
    const folder = path.join(workshop, 'content', '252950', '964271505')
    await mkdir(path.join(folder, 'Assets'), { recursive: true })
    const bytes = makePackage(['Core', 'Package', 'Engine'], [['Package', 0, 'Engine']])
    await writeFile(path.join(folder, 'Map.udk'), bytes)
    await writeFile(path.join(folder, 'Assets', 'CustomAssets.upk'), 'ASSETS')
    await writeFile(path.join(folder, 'ignored.exe'), 'NEVER IMPORT')
    await writeFile(path.join(workshop, 'appworkshop_252950.acf'), manifest('1555545984'))
    return { root, folder, bytes }
  }

  it('importe map et paquets annexes puis charge/restaure un client Epic sans modifier Steam', async () => {
    const f = await fixture()
    const locals = await localWorkshopItems([f.root])
    expect(locals.get('964271505')?.revision).toBe('1555545984')
    const entry = index().maps[0]
    const acquired = await acquireMarketMap(entry, await tempDir(), {}, [f.root])
    const library = new Library(path.join(await tempDir(), 'library'))
    const map = await library.import(acquired.file, { registryId: entry.id, fingerprint: acquired.fingerprint }, acquired.workshopDirectory)
    expect(map.extras).toEqual(['CustomAssets.upk'])
    const game = await fakeInstall()
    const record = await loadIntoSlot(game, await library.mapFile(map.id), map, undefined, { extras: await library.extraFiles(map.id) })
    expect((await readSlot(game, record)).state).toMatchObject({ kind: 'custom', mapId: entry.id })
    expect(await readFile(targetPath(game))).toEqual(f.bytes)
    await restoreSlot(game, record)
    expect(await readFile(targetPath(game), 'utf8')).toBe('ORIGINAL-UNDERPASS')
    expect(await readFile(path.join(f.folder, 'Map.udk'))).toEqual(f.bytes)
    expect(await readFile(path.join(f.folder, 'Assets', 'CustomAssets.upk'), 'utf8')).toBe('ASSETS')
  })

  it('refuse une copie Steam obsolète et détecte une mise à jour à taille identique', async () => {
    const f = await fixture()
    const entry = index().maps[0]
    const original = downloadFingerprint(entry.download)
    entry.download.workshop!.revision = '1555545985'
    expect(isUpToDate(original, entry.download)).toBe(false)
    expect(isUpToDate('steam:964271505|unknown', entry.download)).toBe(true)
    await expect(acquireMarketMap(entry, await tempDir(), {}, [f.root])).rejects.toThrow(/mets à jour/)
    expect(installedWorkshopRevisions(manifest('123')).get('964271505')).toBe('123')
    expect(isCurrentLocal({ folder: '', revision: '123' }, '124')).toBe(false)
  })

  it('installe un lien direct sans Steam, reconnaît un zip sans nom, et se replie sur Steam si le lien échoue', async () => {
    const f = await fixture()
    const zip = await readFile(await makeZip(path.join(await tempDir(), 'source.zip'), { 'Map.udk': f.bytes }))
    const server = createServer((req, res) => {
      if (req.url === '/denied') { res.writeHead(403); res.end(); return }
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(zip)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    try {
      const entry = index().maps[0]
      entry.download.url = `http://127.0.0.1:${port}/file`
      const acquired = await acquireMarketMap(entry, await tempDir(), {}, [])
      expect(acquired.workshopDirectory).toBe(false)
      expect(path.extname(acquired.file)).toBe('.zip')
      const library = new Library(path.join(await tempDir(), 'library'))
      const map = await library.import(acquired.file)
      expect(await readFile(await library.mapFile(map.id))).toEqual(f.bytes)
      entry.download.url = `http://127.0.0.1:${port}/denied`
      expect((await acquireMarketMap(entry, await tempDir(), {}, [f.root])).workshopDirectory).toBe(true)
      await expect(acquireMarketMap(entry, await tempDir(), { signal: AbortSignal.abort() }, [f.root])).rejects.toThrow()
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
  })

  it('explique un fichier inaccessible sans tenter de télécharger une page Workshop', async () => {
    await expect(acquireMarketMap(index().maps[0], await tempDir(), {}, [])).rejects.toThrow(/clé API seule/)
  })

  it('rejette les collisions de paquets au lieu de renommer et casser les références', async () => {
    const f = await fixture()
    await writeFile(path.join(f.folder, 'Assets', 'Map.udk'), 'OTHER MAP')
    const library = new Library(path.join(await tempDir(), 'library'))
    await expect(library.import(f.folder, {}, true)).rejects.toThrow(/même nom/)
    expect(await library.list()).toEqual([])
  })
})
