import type { RegistryDownload } from './types'

/** Empreinte d'un fichier publié : change dès que l'auteur publie une nouvelle version. */
export const downloadFingerprint = (d: RegistryDownload) => d.workshop && !d.url
  ? `steam:${d.workshop.id}|${d.workshop.revision}`
  : `${d.url}|${d.size ?? ''}`

export const downloadUrls = (d: RegistryDownload): string[] =>
  [d.url, ...(d.mirrors ?? [])].filter((u): u is string => !!u)

/**
 * La version installée est-elle à jour par rapport au registre ?
 * On accepte aussi un miroir (même map publiée sur une autre source), et une taille inconnue.
 */
export function isUpToDate(installed: string | undefined, d: RegistryDownload): boolean {
  if (!installed) return true // installée avant le suivi des versions : on ne sait pas, on ne propose rien
  if (installed.startsWith('steam:')) {
    const [id, revision] = installed.slice(6).split('|')
    return d.workshop?.id === id && (revision === 'unknown' || revision === d.workshop.revision)
  }
  const sep = installed.lastIndexOf('|')
  const url = installed.slice(0, sep)
  const size = Number(installed.slice(sep + 1)) || null
  if (![d.url, ...(d.mirrors ?? [])].includes(url)) return false
  return !size || !d.size || size === d.size
}

/** Compare deux versions « x.y.z » : > 0 si a est plus récente. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}
