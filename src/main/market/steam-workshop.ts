import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { RegistryIndex, SteamWorkshopConfig } from '../../shared/types'
import { t } from '../../shared/i18n'
import { parseRegistry, type SourceResult } from './market'
import { SteamApi, STEAM_SOURCE } from './steam-api'

export interface KeyProtection {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

/** La clé ne sort pas du process principal ; seuls enabled/hasApiKey passent par IPC. */
export class SteamWorkshop {
  private config = { enabled: false, encryptedKey: '' }
  private controller: AbortController | undefined
  private pending: Promise<SourceResult | null> | undefined
  private memory: { at: number; index: RegistryIndex } | undefined
  private saving = Promise.resolve()

  constructor(private dir: string, private protection: KeyProtection, private api = new SteamApi()) {}

  async load() {
    try {
      const raw = JSON.parse(await readFile(path.join(this.dir, 'steam-workshop.json'), 'utf8'))
      this.config = { enabled: raw.enabled === true, encryptedKey: typeof raw.encryptedKey === 'string' ? raw.encryptedKey : '' }
    } catch { /* Première utilisation. */ }
  }

  status(): SteamWorkshopConfig { return { enabled: this.config.enabled, hasApiKey: !!this.config.encryptedKey } }

  private key() {
    if (!this.config.encryptedKey) throw new Error(t('Ajoute une clé API Steam dans les réglages.'))
    try { return this.protection.decrypt(Buffer.from(this.config.encryptedKey, 'base64')) }
    catch { throw new Error(t('La clé Steam ne peut plus être déchiffrée. Enregistre-la à nouveau.')) }
  }

  configure(patch: { enabled?: boolean; apiKey?: string }): Promise<SteamWorkshopConfig> {
    const task = this.saving.catch(() => {}).then(async () => {
      if (!patch || (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') ||
          (patch.apiKey !== undefined && typeof patch.apiKey !== 'string')) throw new Error(t('Réglages Steam invalides.'))
      const next = { ...this.config }
      if (patch.apiKey !== undefined) {
        const key = patch.apiKey.trim()
        if (key && !/^[a-f0-9]{32}$/i.test(key)) throw new Error(t('Une clé API Steam contient 32 caractères hexadécimaux.'))
        if (key) {
          if (!this.protection.available()) throw new Error(t('Le chiffrement sécurisé est indisponible sur ce système.'))
          await this.api.page(key, '*') // Valider avant de remplacer une clé fonctionnelle.
        }
        next.encryptedKey = key ? this.protection.encrypt(key).toString('base64') : ''
      }
      if (patch.enabled !== undefined) next.enabled = patch.enabled
      if (!next.encryptedKey) next.enabled = false
      await mkdir(this.dir, { recursive: true })
      const file = path.join(this.dir, 'steam-workshop.json')
      await writeFile(file + '.tmp', JSON.stringify(next), { mode: 0o600 })
      await rename(file + '.tmp', file)
      this.controller?.abort()
      this.pending = undefined
      this.memory = undefined
      this.config = next
      return this.status()
    })
    this.saving = task.then(() => {}, () => {})
    return task
  }

  catalog(refresh = false): Promise<SourceResult | null> {
    if (!this.config.enabled) return Promise.resolve(null)
    if (!refresh && this.memory && Date.now() - this.memory.at < 30 * 60_000) {
      return Promise.resolve({ source: STEAM_SOURCE, index: this.memory.index, origin: 'live' })
    }
    if (this.pending) return this.pending
    const controller = new AbortController()
    this.controller = controller
    const pending = this.fetchCatalog(controller.signal)
    this.pending = pending
    void pending.finally(() => { if (this.pending === pending) this.pending = undefined }).catch(() => {})
    return pending
  }

  private async fetchCatalog(signal: AbortSignal): Promise<SourceResult | null> {
    const file = path.join(this.dir, 'cache', 'steam-workshop.json')
    try {
      const index = await this.api.catalog(this.key(), signal)
      signal.throwIfAborted()
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file + '.tmp', JSON.stringify(index))
      signal.throwIfAborted()
      await rename(file + '.tmp', file)
      this.memory = { at: Date.now(), index }
      return { source: STEAM_SOURCE, index, origin: 'live' }
    } catch (err) {
      if (signal.aborted) return null
      let index: RegistryIndex | null = this.memory?.index ?? null
      try { index ??= parseRegistry(JSON.parse(await readFile(file, 'utf8')), true) } catch { /* Pas de cache. */ }
      return { source: STEAM_SOURCE, index, origin: index ? 'cache' : 'error', error: `${STEAM_SOURCE.name} : ${(err as Error).message}` }
    }
  }
}
