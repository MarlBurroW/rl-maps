import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { SteamWorkshopConfig } from '../../../shared/types'
import { t } from '../../../shared/i18n'
import { useApp } from '../state'
import { Button } from './Button'
import { useToast } from './Toast'

export function SteamWorkshopSettings() {
  const { refreshMarket } = useApp()
  const toast = useToast()
  const [config, setConfig] = useState<SteamWorkshopConfig | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { void window.api.getSteamWorkshopConfig().then(setConfig).catch(() => setError(t('Réglages Steam indisponibles.'))) }, [])

  const save = async (patch: { enabled?: boolean; apiKey?: string }) => {
    setBusy(true)
    setError('')
    try {
      const result = await window.api.setSteamWorkshopConfig(patch)
      if (!result.ok) { setError(result.error); return }
      setConfig(result.value)
      setKey('')
      await refreshMarket()
      toast('success', t('Réglages Steam enregistrés'))
    } catch { setError(t('Impossible de mettre à jour le catalogue Steam.')) }
    finally { setBusy(false) }
  }

  return (
    <section>
      <h2 className="text-xs font-bold tracking-wider text-muted uppercase">Steam Workshop</h2>
      <p className="mt-1 text-[13px] text-faint">{t('Ajoute les maps publiques du Workshop au market. Les fichiers accessibles sont installables pour Epic comme les autres maps.')}</p>
      <div className="mt-3 space-y-4 rounded-xl border border-line bg-surface p-4">
        <label className="flex items-center gap-3 text-sm font-semibold">
          <input type="checkbox" className="size-4 accent-blue" checked={config?.enabled ?? false}
            disabled={busy || !config?.hasApiKey} onChange={(e) => void save({ enabled: e.target.checked })} />
          {t('Afficher le Workshop Steam')}
        </label>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void save({ apiKey: key, enabled: true }) }}>
          <label htmlFor="steam-api-key" className="text-[13px] font-medium">{t('Clé API Steam')}</label>
          <div className="flex gap-2">
            <input id="steam-api-key" type="password" autoComplete="off" spellCheck={false} value={key}
              onChange={(e) => setKey(e.target.value)} disabled={busy} maxLength={64}
              placeholder={config?.hasApiKey ? t('Clé enregistrée — saisir pour remplacer') : t('Saisis ta clé API Steam')}
              className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:border-blue" />
            <Button type="submit" busy={busy} disabled={!key.trim() || !config}>{t('Enregistrer et activer')}</Button>
            {config?.hasApiKey && <Button type="button" disabled={busy} onClick={() => void save({ apiKey: '', enabled: false })}>{t('Effacer la clé')}</Button>}
          </div>
        </form>
        <p className="text-[12px] text-faint">{t('La clé est chiffrée sur ce PC et envoyée uniquement à Steam. Elle donne accès au catalogue, pas automatiquement aux fichiers.')}</p>
        <p className="text-[13px] text-muted">{t('Si une map est déjà téléchargée dans une bibliothèque Steam, RL Maps peut en importer une copie. Sinon, « Voir sur Steam » indique que le fichier reste à obtenir ; une licence Steam de Rocket League peut être nécessaire.')}</p>
        <Button size="sm" variant="ghost" icon={<ExternalLink className="size-4" />}
          onClick={() => void window.api.openExternal('https://steamcommunity.com/dev/apikey')}>{t('Obtenir une clé API Steam')}</Button>
        {busy && <p role="status" className="text-sm text-muted">{t('Validation et synchronisation du Workshop…')}</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </section>
  )
}
