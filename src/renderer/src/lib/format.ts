export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—'
  const units = ['o', 'Ko', 'Mo', 'Go']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1).replace('.', ',')} ${units[i]}`
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
  if (s < 60) return 'à l’instant'
  const m = s / 60
  if (m < 60) return `il y a ${Math.floor(m)} min`
  const h = m / 60
  if (h < 24) return `il y a ${Math.floor(h)} h`
  const d = h / 24
  if (d < 2) return 'hier'
  if (d < 30) return `il y a ${Math.floor(d)} jours`
  const mo = d / 30
  if (mo < 12) return `il y a ${Math.floor(mo)} mois`
  const y = Math.floor(d / 365)
  return `il y a ${y} an${y > 1 ? 's' : ''}`
}

export const formatDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
