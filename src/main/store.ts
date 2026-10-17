import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { Settings } from '../shared/types'
import { DEFAULT_SOURCES, normalizeSources } from '../shared/config'
import type { SlotRecord } from './game/slot'

interface StoreData {
  settings: Settings
  slot: SlotRecord | null
}

const defaults = (): StoreData => ({
  settings: { install: null, restoreOnExit: true, mapUpdates: 'ask', sources: DEFAULT_SOURCES, favorites: [] },
  slot: null
})

/** Petit store JSON persistant, écrit de façon atomique. */
export class Store {
  private data: StoreData = defaults()
  private writing = Promise.resolve()

  constructor(private file: string) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<StoreData>
      const base = defaults()
      const settings = { ...base.settings, ...raw.settings }
      // Les sources intégrées suivent toujours la version de l'app (nouvelles sources, URLs à jour)
      settings.sources = normalizeSources(raw.settings?.sources)
      this.data = { settings, slot: raw.slot ?? null }
    } catch {
      this.data = defaults()
    }
  }

  get settings(): Settings {
    return this.data.settings
  }

  get slot(): SlotRecord | null {
    return this.data.slot
  }

  async update(patch: { settings?: Partial<Settings>; slot?: SlotRecord | null }): Promise<void> {
    if (patch.settings) {
      this.data.settings = { ...this.data.settings, ...patch.settings }
      if (patch.settings.sources) this.data.settings.sources = normalizeSources(patch.settings.sources)
    }
    if (patch.slot !== undefined) this.data.slot = patch.slot
    const snapshot = JSON.stringify(this.data, null, 2)
    this.writing = this.writing.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true })
      const tmp = this.file + '.tmp'
      await writeFile(tmp, snapshot)
      await rename(tmp, this.file)
    })
    await this.writing
  }
}
