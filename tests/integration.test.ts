// Test bout-en-bout avec le réseau : RLMAPS_NET=1 npx vitest run tests/integration.test.ts
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseRegistry } from '../src/main/market/market'
import { download } from '../src/main/market/download'
import { Library } from '../src/main/library/library'
import { loadIntoSlot, readSlot, restoreSlot, targetPath } from '../src/main/game/slot'
import { fakeInstall, tempDir } from './helpers'

describe.skipIf(!process.env.RLMAPS_NET)('intégration réseau', () => {
  it.each(['lethamyr', 'bakkesplugins'])('%s : télécharge la plus petite map, l’importe et la charge dans une fausse install', async (source) => {
    const index = parseRegistry(JSON.parse(await readFile(path.join(import.meta.dirname, '..', 'registry', 'sources', `${source}.json`), 'utf8')))
    const entry = [...index.maps].filter((m) => m.download.size).sort((a, b) => a.download.size! - b.download.size!)[0]

    const dir = await tempDir()
    let last = 0
    const file = await download(entry.download.url, dir, `${entry.id}.zip`, { onProgress: (r) => (last = r) })
    expect(last).toBe(entry.download.size)

    const lib = new Library(path.join(dir, 'library'))
    const map = await lib.import(file, { registryId: entry.id, name: entry.name })
    expect(map.file).toMatch(/\.(udk|upk)$/i)

    const root = await fakeInstall('ORIGINAL')
    const record = await loadIntoSlot(root, await lib.mapFile(map.id), map)
    expect((await readSlot(root, record)).state).toMatchObject({ kind: 'custom', mapId: entry.id })
    expect((await readFile(targetPath(root))).equals(await readFile(await lib.mapFile(map.id)))).toBe(true)

    await restoreSlot(root)
    expect(await readFile(targetPath(root), 'utf8')).toBe('ORIGINAL')
  }, 120_000)
})
