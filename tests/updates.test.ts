import { describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { downloadFingerprint, isUpToDate } from '../src/shared/updates'
import { Library } from '../src/main/library/library'
import { tempDir } from './helpers'

describe('mises à jour des maps', () => {
  const v1 = { url: 'https://cdn.bakkesplugins.com/uploads/a-Map_1.0.0.zip', size: 1000 }

  it('détecte une nouvelle version (nouveau lien ou nouvelle taille)', () => {
    const installed = downloadFingerprint(v1)
    expect(isUpToDate(installed, v1)).toBe(true)
    expect(isUpToDate(installed, { url: 'https://cdn.bakkesplugins.com/uploads/b-Map_1.1.0.zip', size: 1200 })).toBe(false)
    // Lethamyr remplace le fichier Drive sans changer le lien : seule la taille change
    expect(isUpToDate(installed, { ...v1, size: 1300 })).toBe(false)
  })

  it('accepte un miroir et une taille inconnue, et ne propose rien sans empreinte', () => {
    const installed = downloadFingerprint(v1)
    expect(isUpToDate(installed, { url: 'https://drive.google.com/file/d/x/view', size: 1000, mirrors: [v1.url] })).toBe(true)
    expect(isUpToDate(installed, { url: v1.url, size: null })).toBe(true)
    expect(isUpToDate(downloadFingerprint({ url: v1.url }), { ...v1, size: 5000 })).toBe(true)
    expect(isUpToDate(undefined, v1)).toBe(true)
  })

  it('garde la date d’ajout et l’historique quand on installe une nouvelle version', async () => {
    const dir = await tempDir()
    const file = path.join(dir, 'Map.udk')
    await writeFile(file, 'V1')
    const lib = new Library(path.join(dir, 'library'))
    const first = await lib.import(file, { registryId: 'bp-1', name: 'Map', fingerprint: 'a|2' })
    await lib.patch('bp-1', { lastPlayedAt: '2026-10-01T10:00:00.000Z' })

    await writeFile(file, 'V2!!')
    const second = await lib.import(file, { registryId: 'bp-1', name: 'Map', fingerprint: 'b|4' })
    expect(second).toMatchObject({ addedAt: first.addedAt, lastPlayedAt: '2026-10-01T10:00:00.000Z', fingerprint: 'b|4', size: 4 })
    expect(second.updatedAt).toBeDefined()
    expect(first.updatedAt).toBeUndefined()
  })
})
