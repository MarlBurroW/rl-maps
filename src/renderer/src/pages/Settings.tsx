import { useState, type ReactNode } from 'react'
import { CircleCheck, ExternalLink, FolderOpen, Plus, Radar, Trash2, TriangleAlert } from 'lucide-react'
import type { GameInstall, RegistrySource } from '../../../shared/types'
import { BUILTIN_SOURCE_IDS } from '../../../shared/config'
import { useApp } from '../state'
import { useToast } from '../components/Toast'
import { Button } from '../components/Button'

const TEXTURES_URL = 'https://videogamemods.com/vgm/rocketleague/mods/workshop-textures'
const platformLabel = { epic: 'Epic Games', steam: 'Steam', custom: 'Dossier personnalisé' }

export function SettingsPage() {
  const { status, refreshMarket, settings, saveSettings: update, reloadSettings } = useApp()
  const toast = useToast()
  const [detected, setDetected] = useState<GameInstall[] | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [newSource, setNewSource] = useState({ name: '', url: '' })

  const updateSources = async (sources: RegistrySource[]) => {
    await update({ sources })
    await refreshMarket()
  }

  const detect = async () => {
    setDetecting(true)
    try {
      setDetected(await window.api.detectInstalls())
    } finally {
      setDetecting(false)
    }
  }

  const pick = async () => {
    const r = await window.api.pickInstallFolder()
    if (!r.ok) toast('error', 'Dossier invalide', r.error)
    else if (r.value) await reloadSettings()
  }

  const addSource = async () => {
    const url = newSource.url.trim()
    if (!/^https:\/\//.test(url)) return toast('error', 'URL invalide', "L'URL du registre doit commencer par https://")
    const source: RegistrySource = {
      id: `src-${Date.now().toString(36)}`,
      name: newSource.name.trim() || new URL(url).hostname,
      url,
      enabled: true
    }
    setNewSource({ name: '', url: '' })
    await updateSources([...(settings?.sources ?? []), source])
  }

  if (!settings) return null
  const install = settings.install

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-8 px-8 py-7">
        <h1 className="font-display text-2xl font-bold">Réglages</h1>

        <Section title="Rocket League" desc="L'app remplace une arène Labs de Free Play par la map choisie : Underpass en général, Utopia Retro pour les maps qui réutilisent des éléments d'Underpass.">
          <div className="flex items-center gap-4 rounded-xl border border-line bg-surface p-4">
            {status?.valid ? <CircleCheck className="size-5 shrink-0 text-ok" /> : <TriangleAlert className="size-5 shrink-0 text-warn" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{install ? platformLabel[install.platform] : 'Aucune installation configurée'}</p>
              <p className="selectable truncate text-[13px] text-muted" title={install?.root}>
                {install?.root ?? 'Lance une détection ou choisis le dossier du jeu.'}
              </p>
            </div>
            <Button size="sm" icon={<Radar className="size-4" />} busy={detecting} onClick={() => void detect()}>
              Détecter
            </Button>
            <Button size="sm" icon={<FolderOpen className="size-4" />} onClick={() => void pick()}>
              Choisir…
            </Button>
          </div>
          {detected && (
            <div className="mt-2 space-y-1.5">
              {detected.length === 0 && <p className="text-[13px] text-muted">Aucune installation trouvée automatiquement.</p>}
              {detected.map((d) => {
                const current = install?.root.toLowerCase() === d.root.toLowerCase()
                return (
                  <button
                    key={d.root}
                    onClick={() => void update({ install: d })}
                    className={`flex w-full items-center gap-3 rounded-lg border px-4 py-2.5 text-left text-[13px] transition ${
                      current ? 'border-blue/60 bg-blue/10' : 'border-line hover:border-faint'
                    }`}
                  >
                    <span className="font-semibold">{platformLabel[d.platform]}</span>
                    <span className="truncate text-muted">{d.root}</span>
                    {current && <span className="ml-auto text-blue">Utilisée</span>}
                  </button>
                )
              })}
            </div>
          )}
        </Section>

        <Section title="Comportement">
          <Toggle
            label="Restaurer l'original en quittant l'app"
            desc="Remet les arènes d'origine à la fermeture, pour ne jamais rester avec une map custom en ligne."
            checked={settings.restoreOnExit}
            onChange={(v) => void update({ restoreOnExit: v })}
          />
          <Toggle
            label="Mettre à jour les maps automatiquement"
            desc="Installe d'office les nouvelles versions publiées par les auteurs. Sinon, un badge « Mise à jour » te les propose."
            checked={settings.mapUpdates === 'auto'}
            onChange={(v) => void update({ mapUpdates: v ? 'auto' : 'ask' })}
          />
        </Section>

        <Section
          title="Sources du market"
          desc="Les maps présentes dans plusieurs sources sont fusionnées : la première source de la liste fournit la fiche, les autres servent de liens de secours. Ajoute tes propres registres JSON (voir registry/README.md)."
        >
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {settings.sources.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) =>
                    void updateSources(settings.sources.map((x) => (x.id === s.id ? { ...x, enabled: e.target.checked } : x)))
                  }
                  className="size-4 accent-blue"
                  aria-label={`Activer ${s.name}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {s.name}
                    {BUILTIN_SOURCE_IDS.has(s.id) && <span className="ml-2 text-[11px] font-medium text-faint">intégrée</span>}
                  </p>
                  <p className="selectable truncate text-[12px] text-faint">{s.url}</p>
                </div>
                {!BUILTIN_SOURCE_IDS.has(s.id) && (
                  <button
                    onClick={() => void updateSources(settings.sources.filter((x) => x.id !== s.id))}
                    className="rounded-md p-1.5 text-faint hover:bg-danger/10 hover:text-danger"
                    aria-label={`Supprimer ${s.name}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ))}
            <form
              className="flex items-center gap-2 bg-surface-2/40 px-4 py-3"
              onSubmit={(e) => {
                e.preventDefault()
                void addSource()
              }}
            >
              <input
                value={newSource.name}
                onChange={(e) => setNewSource((s) => ({ ...s, name: e.target.value }))}
                placeholder="Nom"
                className="h-8 w-36 rounded-md border border-line bg-bg px-2.5 text-[13px] outline-none focus:border-blue"
              />
              <input
                value={newSource.url}
                onChange={(e) => setNewSource((s) => ({ ...s, url: e.target.value }))}
                placeholder="https://…/index.json"
                className="h-8 flex-1 rounded-md border border-line bg-bg px-2.5 text-[13px] outline-none focus:border-blue"
              />
              <Button size="sm" type="submit" icon={<Plus className="size-4" />} disabled={!newSource.url.trim()}>
                Ajouter
              </Button>
            </form>
          </div>
        </Section>

        <Section title="Aide">
          <div className="space-y-3 rounded-xl border border-line bg-surface p-5 text-sm leading-relaxed">
            <p className="font-semibold">Jouer une map custom</p>
            <ol className="list-inside list-decimal space-y-1 text-muted">
              <li>Clique sur « Jouer » sur une map de ta bibliothèque.</li>
              <li>
                Sur Epic, lance le jeu via Bibliothèque → Rocket League → <b className="text-fg">⋯ → Lancer sans anti-triche</b>.
              </li>
              <li>Entraînement → Free Play → choisis l'arène indiquée en bas de l'app (« Underpass » le plus souvent).</li>
              <li>Restaure l'original avant de rejouer en ligne (automatique en quittant l'app si l'option est active).</li>
            </ol>
            <p className="pt-2 font-semibold">Textures roses ?</p>
            <p className="text-muted">
              Certaines maps utilisent des textures du Workshop absentes du jeu. Installe le pack de textures une fois pour toutes dans le
              dossier <code className="text-fg">TAGame/CookedPCConsole</code>.
            </p>
            <Button size="sm" variant="ghost" icon={<ExternalLink className="size-4" />} onClick={() => window.api.openExternal(TEXTURES_URL)}>
              Pack de textures Workshop
            </Button>
          </div>
        </Section>

        <Section title="Données">
          <Button icon={<FolderOpen className="size-4" />} onClick={() => window.api.openDataFolder()}>
            Ouvrir le dossier de l'app
          </Button>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xs font-bold tracking-wider text-muted uppercase">{title}</h2>
      {desc && <p className="mt-1 text-[13px] text-faint">{desc}</p>}
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  )
}

function Toggle({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-4 rounded-xl border border-line bg-surface p-4">
      <div className="flex-1">
        <p className="text-sm font-semibold">{label}</p>
        {desc && <p className="mt-0.5 text-[13px] text-muted">{desc}</p>}
      </div>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative h-6 w-11 shrink-0 rounded-full bg-line transition peer-checked:bg-blue after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5" />
    </label>
  )
}
