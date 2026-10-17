import { getLang, plural, t } from '../../../shared/i18n'

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—'
  const units = getLang() === 'en' ? ['B', 'KB', 'MB', 'GB'] : ['o', 'Ko', 'Mo', 'Go']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const num = v.toFixed(v >= 100 || i === 0 ? 0 : 1)
  return `${getLang() === 'en' ? num : num.replace('.', ',')} ${units[i]}`
}

/** Normalise pour la recherche : minuscules, sans accents. */
export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** « il y a 3 jours », « hier », « à l'instant »… */
export function timeAgo(iso: string | undefined, now = Date.now()): string | null {
  if (!iso) return null
  const s = Math.max(0, (now - Date.parse(iso)) / 1000)
  if (s < 60) return t('à l’instant')
  const m = s / 60
  if (m < 60) return t('il y a {n} min', { n: Math.floor(m) })
  const h = m / 60
  if (h < 24) return t('il y a {n} h', { n: Math.floor(h) })
  const d = h / 24
  if (d < 2) return t('hier')
  if (d < 30) return t('il y a {n} jours', { n: Math.floor(d) })
  const mo = d / 30
  if (mo < 12) return t('il y a {n} mois', { n: Math.floor(mo) })
  return plural(Math.floor(d / 365), 'il y a {n} an', 'il y a {n} ans')
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
