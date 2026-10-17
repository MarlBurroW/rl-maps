import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describeDependency, missingDependencies } from '../src/shared/compat'
import { gamePackages } from '../src/main/game/packages'
import { cookedDir } from '../src/main/game/slot'
import { Library } from '../src/main/library/library'
import { mergeRegistries, parseRegistry } from '../src/main/market/market'
import { DEFAULT_SOURCES } from '../src/shared/config'
import { fakeInstall, makePackage, tempDir } from './helpers'

describe('compatibilité des maps', () => {
  const present = new Set(['labs_underpass_p', 'park_p', 'enginematerials'])

  it('liste les dépendances absentes, sans compter les paquets de script ou d’éditeur', () => {
    expect(missingDependencies(['Engine', 'TAGame', 'UnrealEd', 'Park_P', 'grass_textures', 'LethNeonHeightsPack'], present)).toEqual([
      'grass_textures',
      'LethNeonHeightsPack'
    ])
    expect(missingDependencies(['PARK_P', 'EngineMaterials'], present)).toEqual([])
  })

  it('renvoie undefined quand on ne sait pas', () => {
    expect(missingDependencies(null, present)).toBeUndefined()
    expect(missingDependencies(undefined, present)).toBeUndefined()
    expect(missingDependencies(['Park_P'], null)).toBeUndefined()
  })

  it('explique les paquets connus, les packs d’auteur et le reste', () => {
    expect(describeDependency('grass_textures').reason).toMatch(/supprimé/)
    expect(describeDependency('4v4MapPack').reason).toMatch(/créateur/)
    expect(describeDependency('Truc_P').reason).toMatch(/Absent/)
  })

  it('inventorie les paquets du jeu, sous-dossiers compris', async () => {
    const root = await fakeInstall()
    await mkdir(path.join(cookedDir(root), 'mods'), { recursive: true })
    await writeFile(path.join(cookedDir(root), 'mods', 'Grass_Textures.upk'), '')
    await writeFile(path.join(cookedDir(root), 'Engine.u'), '')
    await writeFile(path.join(cookedDir(root), 'SFX.bnk'), '')
    const names = await gamePackages(root)
    expect([...names].sort()).toEqual(['engine', 'grass_textures', 'labs_underpass_p'])
  })

  it('lit les dépendances d’une map à l’import dans la bibliothèque', async () => {
    const dir = await tempDir()
    const file = path.join(dir, 'Map.udk')
    await writeFile(
      file,
      makePackage(['Core', 'Package', 'Texture2D', 'grass_textures', 'GrassCube'], [
        ['Package', 0, 'grass_textures'],
        ['Texture2D', -1, 'GrassCube']
      ])
    )
    const map = await new Library(path.join(dir, 'library')).import(file)
    expect(map.imports).toEqual(['grass_textures'])
  })

  it('garde les dépendances lues par une autre source lors de la fusion', () => {
    const index = (imports: string[] | null, url: string) =>
      parseRegistry({ maps: [{ id: url.slice(-1), name: 'Rings', author: 'Leth', tags: [], download: { url }, imports }] })
    const [merged] = mergeRegistries([
      { source: DEFAULT_SOURCES[0], index: index(null, 'https://x/a') },
      { source: DEFAULT_SOURCES[1], index: index(['Park_P'], 'https://x/b') }
    ])
    expect(merged.imports).toEqual(['Park_P'])
  })
})
