import type { RegistryDownload } from './types'

/** Empreinte d'un fichier publié : change dès que l'auteur publie une nouvelle version. */
export const downloadFingerprint = (d: RegistryDownload) => `${d.url}|${d.size ?? ''}`

/**
 * La version installée est-elle à jour par rapport au registre ?
 * On accepte aussi un miroir (même map publiée sur une autre source), et une taille inconnue.
 */
export function isUpToDate(installed: string | undefined, d: RegistryDownload): boolean {
  if (!installed) return true // installée avant le suivi des versions : on ne sait pas, on ne propose rien
  const sep = installed.lastIndexOf('|')
  const url = installed.slice(0, sep)
  const size = Number(installed.slice(sep + 1)) || null
  if (![d.url, ...(d.mirrors ?? [])].includes(url)) return false
  return !size || !d.size || size === d.size
}
