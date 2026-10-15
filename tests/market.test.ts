import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { mergeRegistries, parseRegistry } from '../src/main/market/market'
import { DEFAULT_SOURCES, normalizeSources } from '../src/shared/config'
import type { RegistryIndex, RegistryMap } from '../src/shared/types'
import { filenameFromResponse, toDirectUrl } from '../src/main/market/download'
import { parseLibraryFolders } from '../src/main/game/detect'

describe('liens de téléchargement', () => {
  it('convertit les liens Google Drive en téléchargement direct', () => {
    const direct = 'https://drive.usercontent.google.com/download?id=1q1HoSA5sCn8vprWzTOSKt1-QxbNs_vQJ&export=download&confirm=t'
    expect(toDirectUrl('https://drive.google.com/file/d/1q1HoSA5sCn8vprWzTOSKt1-QxbNs_vQJ/view?usp=drive_link')).toBe(direct)
    expect(toDirectUrl('https://drive.google.com/open?id=1q1HoSA5sCn8vprWzTOSKt1-QxbNs_vQJ')).toBe(direct)
    expect(toDirectUrl('https://drive.google.com/uc?export=download&id=1q1HoSA5sCn8vprWzTOSKt1-QxbNs_vQJ')).toBe(direct)
  })

  it('force le téléchargement Dropbox et laisse les autres liens intacts', () => {
    expect(toDirectUrl('https://www.dropbox.com/s/abc/map.zip?dl=0')).toBe('https://www.dropbox.com/s/abc/map.zip?dl=1')
    expect(toDirectUrl('https://github.com/x/y/releases/download/v1/map.zip')).toBe('https://github.com/x/y/releases/download/v1/map.zip')
  })

  it('déduit un nom de fichier sûr', () => {
    const res = (headers: Record<string, string>, url = 'https://example.com/dl') => {
      const r = new Response('', { headers })
      Object.defineProperty(r, 'url', { value: url })
      return r
    }
    expect(filenameFromResponse(res({ 'content-disposition': 'attachment; filename="LethAbstract.zip"' }), 'x.zip')).toBe('LethAbstract.zip')
    expect(filenameFromResponse(res({ 'content-disposition': "attachment; filename*=UTF-8''Caf%C3%A9.zip" }), 'x.zip')).toBe('Café.zip')
    expect(filenameFromResponse(res({ 'content-disposition': 'attachment; filename="../../evil.zip"' }), 'x.zip')).toBe('evil.zip')
    expect(filenameFromResponse(res({}, 'https://example.com/files/Map.udk'), 'x.zip')).toBe('Map.udk')
    expect(filenameFromResponse(res({}), 'fallback.zip')).toBe('fallback.zip')
  })
})

describe('registre', () => {
  it('ignore les entrées invalides sans rejeter tout le registre', () => {
    const index = parseRegistry({
      name: 'Test',
      maps: [
        { id: 'ok', name: 'OK', author: 'me', tags: ['A', 3], download: { url: 'https://x/y.zip' }, thumbnail: 'http://insecure' },
        { id: '../bad', name: 'Bad', download: { url: 'https://x' } },
        { id: 'nourl', name: 'No URL', download: {} },
        { id: 'http', name: 'HTTP', download: { url: 'http://x' } }
      ]
    })
    expect(index.maps.map((m) => m.id)).toEqual(['ok'])
    expect(index.maps[0].tags).toEqual(['A'])
    expect(index.maps[0].thumbnail).toBeNull()
    expect(() => parseRegistry({ foo: 1 })).toThrow()
  })

  it('les registres embarqués sont valides, sans id en double', () => {
    const dir = path.join(import.meta.dirname, '..', 'registry', 'sources')
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
    expect(files.sort()).toEqual(DEFAULT_SOURCES.map((s) => `${s.id}.json`).sort())
    const ids = new Set<string>()
    let total = 0
    for (const f of files) {
      const raw = JSON.parse(readFileSync(path.join(dir, f), 'utf8'))
      const index = parseRegistry(raw)
      expect(index.maps.length, f).toBe(raw.maps.length)
      for (const m of index.maps) {
        expect(ids.has(m.id), m.id).toBe(false)
        ids.add(m.id)
      }
      total += index.maps.length
    }
    expect(total).toBeGreaterThan(400)
  })
})

describe('fusion des sources', () => {
  const map = (id: string, name: string, author: string, url: string, extra: Partial<RegistryMap> = {}): RegistryMap => ({
    id,
    name,
    author,
    tags: [],
    download: { url },
    ...extra
  })
  const index = (maps: RegistryMap[]): RegistryIndex => ({ version: 1, name: 'x', updatedAt: '', maps })
  const [leth, bp, community] = DEFAULT_SOURCES

  it('fusionne une même map publiée sur deux sources, la seconde devient un miroir', () => {
    const merged = mergeRegistries([
      { source: leth, index: index([map('lethamyr-ice-rings', 'Ice Rings', 'Lethamyr', 'https://drive/a', { tags: ['Training'], homepage: 'https://l/1' })]) },
      {
        source: bp,
        index: index([
          map('bakkesplugins-138', 'Ice-Rings', 'lethamyr', 'https://cdn/b', { tags: ['Aerial', 'Hide & Seek'], homepage: 'https://b/138' }),
          map('bakkesplugins-1', 'Autre', 'Quelqu’un', 'https://cdn/c')
        ])
      }
    ])
    expect(merged.map((m) => m.id)).toEqual(['bakkesplugins-1', 'lethamyr-ice-rings'])
    const rings = merged[1]
    expect(rings.sourceId).toBe('lethamyr')
    expect(rings.download).toMatchObject({ url: 'https://drive/a', mirrors: ['https://cdn/b'] })
    expect(rings.tags).toEqual(['Training', 'Aerial', 'Hide and Seek'])
    expect(rings.sources).toEqual([
      { id: 'lethamyr', name: 'Lethamyr', homepage: 'https://l/1' },
      { id: 'bakkesplugins', name: 'BakkesPlugins', homepage: 'https://b/138' }
    ])
  })

  it("ne fusionne pas deux maps de même nom mais d'auteurs différents", () => {
    const merged = mergeRegistries([
      { source: leth, index: index([map('a', 'Rings', 'Lethamyr', 'https://x/a')]) },
      { source: community, index: index([map('b', 'Rings', 'Bob', 'https://x/b')]) }
    ])
    expect(merged.length).toBe(2)
  })

  it('fusionne les vrais registres Lethamyr et BakkesPlugins', () => {
    const load = (id: string) => parseRegistry(JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'registry', 'sources', `${id}.json`), 'utf8')))
    const l = load('lethamyr')
    const b = load('bakkesplugins')
    const merged = mergeRegistries([
      { source: leth, index: l },
      { source: bp, index: b }
    ])
    const both = merged.filter((m) => m.sources.length > 1)
    expect(merged.length).toBeLessThan(l.maps.length + b.maps.length)
    expect(both.length).toBeGreaterThan(100)
    // Fiche Lethamyr (source officielle), fichier du CDN BakkesPlugins en secours
    expect(both.every((m) => m.sourceId === 'lethamyr' && m.download.mirrors![0].startsWith('https://cdn.bakkesplugins.com/'))).toBe(true)
  })
})

describe('sources configurées', () => {
  it('migre une ancienne config : sources intégrées à jour, choix et sources perso conservés', () => {
    const sources = normalizeSources([
      { id: 'community', name: 'Ancien', url: 'https://old/index.json', enabled: false },
      { id: 'perso', name: 'Perso', url: 'https://moi/maps.json', enabled: true }
    ])
    expect(sources.map((s) => s.id)).toEqual(['lethamyr', 'bakkesplugins', 'community', 'perso'])
    expect(sources[2]).toEqual({ ...DEFAULT_SOURCES[2], enabled: false })
    expect(sources[3].url).toBe('https://moi/maps.json')
  })
})

describe('détection Steam', () => {
  it('lit les bibliothèques de libraryfolders.vdf', () => {
    const vdf = `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}`
    expect(parseLibraryFolders(vdf)).toEqual(['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary'])
  })
})

describe('miroirs de téléchargement', () => {
  it('passe au miroir suivant quand le premier lien échoue', async () => {
    const { downloadFirst } = await import('../src/main/market/download')
    const { tempDir } = await import('./helpers')
    const { createServer } = await import('node:http')
    const server = createServer((req, res) => {
      if (req.url === '/quota') {
        res.writeHead(200, { 'content-type': 'text/html' })
        return res.end('<html>Quota exceeded</html>')
      }
      res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="Map.zip"' })
      res.end('PK-data')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const { port } = server.address() as { port: number }
    try {
      const file = await downloadFirst([`http://127.0.0.1:${port}/quota`, `http://127.0.0.1:${port}/ok`], await tempDir(), 'x.zip')
      expect(path.basename(file)).toBe('Map.zip')
      expect(readFileSync(file, 'utf8')).toBe('PK-data')
      await expect(downloadFirst([`http://127.0.0.1:${port}/quota`], await tempDir(), 'x.zip')).rejects.toThrow(/page web/)
    } finally {
      server.close()
    }
  })
})
