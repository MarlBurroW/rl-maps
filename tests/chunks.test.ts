import { describe, expect, it } from 'vitest'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pickContent } from '../src/main/library/archive'
import { Library } from '../src/main/library/library'
import { cookedDir, loadIntoSlot, restoreSlot, selectExtras } from '../src/main/game/slot'
import { fakeInstall, makePackage, makeZip, tempDir } from './helpers'

const f = (name: string, size: number) => ({ name, size, path: name })

describe('maps en plusieurs paquets', () => {
  it('prend la map principale hors pack de textures, le reste devient annexe', () => {
    const picked = pickContent([f('EngineDebugMaterials.upk', 900), f('HH_Mansion.upk', 500), f('HH_PuzzleOne.upk', 100), f('MapTemplates.upk', 50)])
    expect(picked.map?.name).toBe('HH_Mansion.upk')
    expect(picked.extras.map((e) => e.name)).toEqual(['EngineDebugMaterials.upk', 'HH_PuzzleOne.upk', 'MapTemplates.upk'])
  })

  it('range les paquets annexes avec la map dans la bibliothèque', async () => {
    const dir = await tempDir()
    const zip = await makeZip(path.join(dir, 'HH.zip'), {
      'HH/HH_Mansion.upk': 'M'.repeat(50),
      'HH/HH_PuzzleOne.upk': 'P1',
      'HH/HH_PuzzleTwo.upk': 'P2'
    })
    const lib = new Library(path.join(dir, 'library'))
    const map = await lib.import(zip, { registryId: 'leth-hh', name: 'Haunted Hallows' })
    expect(map.file).toBe('HH_Mansion.upk')
    expect(map.extras).toEqual(['HH_PuzzleOne.upk', 'HH_PuzzleTwo.upk'])
    const extras = await lib.extraFiles('leth-hh')
    expect(await readFile(extras[0].path, 'utf8')).toBe('P1')
  })

  it('choisit le paquet qui contient un niveau, même s’il n’est pas le plus gros (cas Quidditch)', async () => {
    const dir = await tempDir()
    const names = ['Core', 'Package', 'Class', 'World', 'Engine', 'StaticMesh', 'Mesh1']
    const level = makePackage(names, [
      ['Package', 0, 'Engine'],
      ['Class', -1, 'World']
    ])
    const assets = Buffer.concat([
      makePackage(names, [
        ['Package', 0, 'Engine'],
        ['StaticMesh', -1, 'Mesh1']
      ]),
      Buffer.alloc(5000) // paquet d'assets plus lourd que le niveau
    ])
    const zip = await makeZip(path.join(dir, 'Quidditch.zip'), { 'meshes.upk': assets, 'Quidditch.upk': level })
    const map = await new Library(path.join(dir, 'library')).import(zip)
    expect(map.file).toBe('Quidditch.upk')
    expect(map.extras).toEqual(['meshes.upk'])
  })

  it('ne remplace jamais un fichier du jeu, sauf les annexes du chargement précédent', () => {
    const extras = [
      { name: 'HH_PuzzleOne.upk', path: 'a' },
      { name: 'EngineMaterials.upk', path: 'b' },
      { name: 'Shared.upk', path: 'c' }
    ]
    const present = new Set(['enginematerials', 'shared', 'labs_underpass_p'])
    expect(selectExtras(extras, present, null).map((e) => e.name)).toEqual(['HH_PuzzleOne.upk'])
    const previous = { mapId: 'x', mapName: 'X', size: 1, extras: ['Shared.upk'] }
    expect(selectExtras(extras, present, previous).map((e) => e.name)).toEqual(['HH_PuzzleOne.upk', 'Shared.upk'])
  })

  it('copie les annexes au chargement et les retire au changement de map et à la restauration', async () => {
    const root = await fakeInstall('ORIGINAL')
    const dir = await tempDir()
    const write = async (name: string, content: string) => {
      const p = path.join(dir, name)
      await writeFile(p, content)
      return p
    }
    const main = await write('HH_Mansion.upk', 'MAIN')
    const extras = [{ name: 'HH_PuzzleOne.upk', path: await write('HH_PuzzleOne.upk', 'P1') }]

    const record = await loadIntoSlot(root, main, { id: 'hh', name: 'HH' }, undefined, { extras })
    expect(record.extras).toEqual(['HH_PuzzleOne.upk'])
    expect(await readFile(path.join(cookedDir(root), 'HH_PuzzleOne.upk'), 'utf8')).toBe('P1')

    // Une autre map : les annexes de la précédente disparaissent
    const other = await loadIntoSlot(root, await write('Other.udk', 'OTHER'), { id: 'o', name: 'O' }, undefined, { previous: record })
    expect(other.extras).toBeUndefined()
    expect(await readdir(cookedDir(root))).not.toContain('HH_PuzzleOne.upk')

    const again = await loadIntoSlot(root, main, { id: 'hh', name: 'HH' }, undefined, { extras, previous: other })
    await restoreSlot(root, again)
    expect((await readdir(cookedDir(root))).sort()).toEqual(['Labs_Underpass_P.upk'])
    expect(await readFile(path.join(cookedDir(root), 'Labs_Underpass_P.upk'), 'utf8')).toBe('ORIGINAL')
  })
})
