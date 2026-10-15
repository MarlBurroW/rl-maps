import { describe, expect, it } from 'vitest'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { extractZip, pickContent } from '../src/main/library/archive'
import { Library } from '../src/main/library/library'
import { makeZip, tempDir } from './helpers'

describe('archive', () => {
  it("n'extrait que les fichiers utiles, à plat", async () => {
    const dir = await tempDir()
    const zip = await makeZip(path.join(dir, 'm.zip'), {
      'Folder/MyMap.udk': 'x'.repeat(100),
      'Folder/preview.png': 'img',
      'Other/preview.png': 'img2',
      'readme.txt': 'ignored',
      'Folder/info.json': '{}'
    })
    const out = path.join(dir, 'out')
    const files = await extractZip(zip, out)

    expect(files.map((f) => f.name).sort()).toEqual(['MyMap.udk', 'info.json', 'preview-2.png', 'preview.png'])
    expect((await readdir(out)).sort()).toEqual(['MyMap.udk', 'info.json', 'preview-2.png', 'preview.png'])
  })

  it('rejette une archive piégée (zip-slip) sans rien écrire hors du dossier', async () => {
    const dir = await tempDir()
    const zip = await makeZip(path.join(dir, 'evil.zip'), { 'Map.udk': 'ok', '../../evil.udk': 'evil' })
    await expect(extractZip(zip, path.join(dir, 'out'))).rejects.toThrow(/Archive invalide/)
    expect((await readdir(dir)).sort()).toEqual(['evil.zip', 'out'])
    expect(await readdir(path.join(dir, '..'))).not.toContain('evil.udk')
  })

  it('choisit le plus gros fichier de map', () => {
    const f = (name: string, size: number) => ({ name, size, path: name })
    const picked = pickContent([f('small.upk', 10), f('Big.udk', 500), f('a.png', 5), f('b.jpg', 50)])
    expect(picked.map?.name).toBe('Big.udk')
    expect(picked.thumbnail?.name).toBe('b.jpg')
  })
})

describe('bibliothèque', () => {
  it('importe un zip Lethamyr (info.json + image) et le liste', async () => {
    const dir = await tempDir()
    const zip = await makeZip(path.join(dir, 'LethAbstract.zip'), {
      'LethAbstract/LethAbstract3.udk': 'MAPDATA',
      'LethAbstract/252950_shot.png': 'PNG',
      'LethAbstract/info.json': JSON.stringify({ author: 'Lethamyr', desc: 'Abstract' })
    })
    const lib = new Library(path.join(dir, 'library'))
    const map = await lib.import(zip)

    expect(map).toMatchObject({ name: 'Abstract', author: 'Lethamyr', file: 'LethAbstract3.udk', size: 7 })
    expect(map.thumbnail).toMatch(/^rlmaps:\/\/library\/abstract-[0-9a-f]{6}\/thumb\.png$/)
    expect(await readFile(await lib.mapFile(map.id), 'utf8')).toBe('MAPDATA')
    expect((await lib.list()).map((m) => m.id)).toEqual([map.id])
    // pas de dossier de staging résiduel
    expect(await readdir(lib.dir)).toEqual([map.id])

    await lib.remove(map.id)
    expect(await lib.list()).toEqual([])
  })

  it("utilise l'id du registre et remplace une installation précédente", async () => {
    const dir = await tempDir()
    const file = path.join(dir, 'Ring.udk')
    await writeFile(file, 'V1')
    const lib = new Library(path.join(dir, 'library'))
    await lib.import(file, { registryId: 'lethamyr-rings', name: 'Rings', tags: ['Race'] })
    await writeFile(file, 'V2!')
    const map = await lib.import(file, { registryId: 'lethamyr-rings', name: 'Rings', tags: ['Race'] })

    expect(map).toMatchObject({ id: 'lethamyr-rings', name: 'Rings', tags: ['Race'], registryId: 'lethamyr-rings', size: 3 })
    expect((await lib.list()).length).toBe(1)
  })

  it('refuse les formats non supportés et les zips sans map', async () => {
    const dir = await tempDir()
    const lib = new Library(path.join(dir, 'library'))
    await writeFile(path.join(dir, 'x.rar'), '')
    await expect(lib.import(path.join(dir, 'x.rar'))).rejects.toThrow(/non supporté/)
    const zip = await makeZip(path.join(dir, 'empty.zip'), { 'readme.txt': 'hi' })
    await expect(lib.import(zip)).rejects.toThrow(/Aucun fichier/)
    expect(await readdir(lib.dir)).toEqual([])
  })

  it('refuse les ids qui sortiraient du dossier', async () => {
    const lib = new Library(await tempDir())
    await expect(lib.remove('../outside')).rejects.toThrow(/invalide/)
    expect(lib.resolveThumb('ok-id', '../meta.json')).toBeNull()
  })
})
