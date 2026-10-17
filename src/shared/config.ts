import type { RegistrySource } from './types'
import { tk } from './i18n'

/**
 * Registres publics par défaut : les fichiers registry/sources/*.json de ce dépôt, servis par GitHub.
 * Ils sont régénérés chaque semaine par la CI (.github/workflows/registry.yml).
 * Tant qu'une URL n'est pas joignable, l'app utilise sa copie embarquée du même fichier.
 * L'ordre compte : en cas de doublon entre sources, la première fournit la fiche et les suivantes
 * deviennent des miroirs de téléchargement.
 */
const RAW = 'https://raw.githubusercontent.com/MarlBurroW/rl-maps/main/registry/sources'

export const DEFAULT_SOURCES: RegistrySource[] = [
  { id: 'lethamyr', name: 'Lethamyr', url: `${RAW}/lethamyr.json`, enabled: true },
  { id: 'bakkesplugins', name: 'BakkesPlugins', url: `${RAW}/bakkesplugins.json`, enabled: true },
  { id: 'vgm', name: 'VGM', url: `${RAW}/vgm.json`, enabled: true },
  { id: 'community', name: tk('Communauté'), url: `${RAW}/community.json`, enabled: true }
]

export const BUILTIN_SOURCE_IDS = new Set(DEFAULT_SOURCES.map((s) => s.id))

/**
 * Sources effectives : les sources intégrées (URL et nom imposés, seul « activé » est conservé),
 * suivies des sources ajoutées par l'utilisateur.
 */
export function normalizeSources(saved: RegistrySource[] | undefined): RegistrySource[] {
  const byId = new Map((saved ?? []).map((s) => [s.id, s]))
  const builtins = DEFAULT_SOURCES.map((d) => ({ ...d, enabled: byId.get(d.id)?.enabled ?? d.enabled }))
  const custom = (saved ?? []).filter((s) => !BUILTIN_SOURCE_IDS.has(s.id))
  return [...builtins, ...custom]
}
