import { t, tk } from './i18n'

// Compatibilité d'une map avec le jeu installé : quels paquets dont elle dépend sont absents.

/**
 * Paquets sans effet sur le rendu : scripts compilés dans l'exécutable, ou paquets d'éditeur
 * référencés par les maps mais jamais utilisés en jeu.
 */
const IGNORED = new Set([
  'core',
  'engine',
  'tagame',
  'projectx',
  'gfxui',
  'akaudio',
  'ipdrv',
  'windrv',
  'xaudio2',
  'gameframework',
  'onlinesubsystemsteamworks',
  'onlinesubsystemepic',
  'unrealed',
  'editor',
  'unrealscripttest'
])

/** Dépendances absentes du jeu, ou undefined si on ne sait pas (map illisible, jeu non configuré). */
export function missingDependencies(imports: string[] | null | undefined, present: Set<string> | null): string[] | undefined {
  if (!imports || !present) return undefined
  return imports.filter((p) => !IGNORED.has(p.toLowerCase()) && !present.has(p.toLowerCase()))
}

export interface DependencyInfo {
  /** Ce que la map perd sans ce paquet */
  effect: string
  /** Pourquoi il manque */
  reason: string
}

const REMOVED_BY_RL = tk('Paquet supprimé par une mise à jour de Rocket League.')

const KNOWN: Record<string, DependencyInfo> = {
  grass_textures: { effect: tk('Reflets de l’environnement (sols et métaux plus ternes)'), reason: REMOVED_BY_RL },
  postprocess: { effect: tk('Effets de post-traitement (flou des reflets, ambiance)'), reason: REMOVED_BY_RL },
  physicalmaterials: { effect: tk('Physique des surfaces (murs collants, rebonds sur les poteaux)'), reason: REMOVED_BY_RL },
  fxactorevents: { effect: tk('Effets visuels déclenchés par des événements'), reason: REMOVED_BY_RL },
  portalpackage: { effect: tk('Physique des surfaces (murs collants)'), reason: tk('Paquet de travail du créateur, jamais publié.') },
  enginemeshes: { effect: tk('Quelques modèles 3D'), reason: REMOVED_BY_RL }
}

export function describeDependency(pkg: string): DependencyInfo {
  const known = KNOWN[pkg.toLowerCase()]
  if (known) return { effect: t(known.effect), reason: t(known.reason) }
  if (/pack(age)?$/i.test(pkg)) {
    return { effect: t('Assets propres à la map (textures, modèles)'), reason: t('Paquet personnel du créateur, jamais publié.') }
  }
  return { effect: t('Textures, matériaux ou modèles'), reason: t('Absent de ton installation de Rocket League.') }
}

export { WORKSHOP_TEXTURE_PACKAGES } from './workshop'
