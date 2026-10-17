import { describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseImports, readPackageImports } from '../src/main/game/upk'
import { makePackage, tempDir } from './helpers'

describe('lecture des imports d’un paquet UE3', () => {
  const names = ['Core', 'Package', 'Material', 'Texture2D', 'Labs_Underpass_P', 'Floor', 'Reflective_Floor_Mat', 'Engine', 'Mats', 'Grid', 'Orphan']

  it('renvoie les paquets racines dont la map utilise des objets', () => {
    const pkg = makePackage(names, [
      ['Package', 0, 'Labs_Underpass_P'], // -1
      ['Package', -1, 'Floor'], // -2 : groupe dans Labs_Underpass_P
      ['Material', -2, 'Reflective_Floor_Mat'],
      ['Package', 0, 'Engine'], // -4
      ['Package', -4, 'Mats'], // -5
      ['Texture2D', -5, 'Grid'],
      ['Package', 0, 'Orphan'] // paquet importé mais jamais utilisé
    ])
    expect(parseImports(pkg)).toEqual(['Engine', 'Labs_Underpass_P'])
  })

  it('lit un fichier sur disque, et renvoie null pour un fichier qui n’est pas un paquet', async () => {
    const dir = await tempDir()
    const file = path.join(dir, 'Map.udk')
    await writeFile(
      file,
      makePackage(names, [
        ['Package', 0, 'Engine'],
        ['Texture2D', -1, 'Grid']
      ])
    )
    expect(await readPackageImports(file)).toEqual(['Engine'])

    await writeFile(path.join(dir, 'junk.udk'), 'pas un paquet')
    expect(await readPackageImports(path.join(dir, 'junk.udk'))).toBeNull()
  })
})
