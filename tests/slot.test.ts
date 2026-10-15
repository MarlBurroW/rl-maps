import { describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { backupPath, isValidInstall, loadIntoSlot, readSlot, restoreSlot, targetPath } from '../src/main/game/slot'
import { fakeInstall, tempDir } from './helpers'

async function mapFile(content: string) {
  const file = path.join(await tempDir(), 'Custom.udk')
  await writeFile(file, content)
  return file
}

describe('slot Underpass', () => {
  it('reconnaît une installation valide', async () => {
    const root = await fakeInstall()
    expect(await isValidInstall(root)).toBe(true)
    expect(await isValidInstall(path.dirname(root))).toBe(false)
  })

  it("charge une map, sauvegarde l'original et le restaure à l'identique", async () => {
    const root = await fakeInstall('ORIGINAL')
    const record = await loadIntoSlot(root, await mapFile('MAP-A'), { id: 'a', name: 'Map A' })

    expect(await readFile(targetPath(root), 'utf8')).toBe('MAP-A')
    expect(await readFile(backupPath(root), 'utf8')).toBe('ORIGINAL')
    expect((await readSlot(root, record)).state).toEqual({ kind: 'custom', mapId: 'a', mapName: 'Map A' })

    await restoreSlot(root)
    expect(await readFile(targetPath(root), 'utf8')).toBe('ORIGINAL')
    expect(existsSync(backupPath(root))).toBe(false)
    expect((await readSlot(root, record)).state).toEqual({ kind: 'original' })
  })

  it("ne réécrit jamais le backup quand on enchaîne plusieurs maps", async () => {
    const root = await fakeInstall('ORIGINAL')
    await loadIntoSlot(root, await mapFile('MAP-A'), { id: 'a', name: 'A' })
    const b = await loadIntoSlot(root, await mapFile('MAP-BB'), { id: 'b', name: 'B' })

    expect(await readFile(targetPath(root), 'utf8')).toBe('MAP-BB')
    expect(await readFile(backupPath(root), 'utf8')).toBe('ORIGINAL')
    expect((await readSlot(root, b)).state).toMatchObject({ kind: 'custom', mapId: 'b' })
  })

  it("signale une map chargée par un autre outil (backup .bak sans record)", async () => {
    const root = await fakeInstall('SOMEONE-ELSES-MAP')
    await writeFile(backupPath(root), 'ORIGINAL')

    expect((await readSlot(root, null)).state).toEqual({ kind: 'unknown' })
    await restoreSlot(root)
    expect(await readFile(targetPath(root), 'utf8')).toBe('ORIGINAL')
  })

  it('oublie un record périmé si le jeu a été réparé (backup disparu)', async () => {
    const root = await fakeInstall('ORIGINAL')
    const { state, record } = await readSlot(root, { mapId: 'a', mapName: 'A', size: 8 })
    expect(state).toEqual({ kind: 'original' })
    expect(record).toBeNull()
  })

  it("passe en « inconnu » si le fichier en place n'est plus celui chargé par l'app", async () => {
    const root = await fakeInstall('ORIGINAL')
    const record = await loadIntoSlot(root, await mapFile('MAP-A'), { id: 'a', name: 'A' })
    await writeFile(targetPath(root), 'AUTRE-MAP-PLUS-LONGUE')
    expect((await readSlot(root, record)).state).toEqual({ kind: 'unknown' })
  })

  it('ne laisse aucun fichier temporaire derrière lui', async () => {
    const root = await fakeInstall()
    await loadIntoSlot(root, await mapFile('MAP'), { id: 'a', name: 'A' })
    await restoreSlot(root)
    const { readdir } = await import('node:fs/promises')
    expect(await readdir(path.dirname(targetPath(root)))).toEqual(['Labs_Underpass_P.upk'])
  })

  it("refuse de charger si l'original est introuvable", async () => {
    const root = await fakeInstall()
    const { rm } = await import('node:fs/promises')
    await rm(targetPath(root))
    await expect(loadIntoSlot(root, await mapFile('MAP'), { id: 'a', name: 'A' })).rejects.toThrow(/introuvable/)
  })
})
