import { describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Store } from '../src/main/store'
import { tempDir } from './helpers'

describe('réglages', () => {
  it("charge d'anciens réglages sans favoris, puis persiste les favoris", async () => {
    const file = path.join(await tempDir(), 'settings.json')
    await writeFile(file, JSON.stringify({ settings: { install: null, restoreOnExit: false }, slot: null }))

    const store = new Store(file)
    await store.load()
    expect(store.settings.favorites).toEqual([])
    expect(store.settings.restoreOnExit).toBe(false)

    await store.update({ settings: { favorites: ['lethamyr-ice-rings', 'bakkesplugins-97'] } })
    const reloaded = new Store(file)
    await reloaded.load()
    expect(reloaded.settings.favorites).toEqual(['lethamyr-ice-rings', 'bakkesplugins-97'])
  })
})
