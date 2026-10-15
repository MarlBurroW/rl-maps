// Construit registry/sources/bakkesplugins.json à partir de https://bakkesplugins.com/maps,
// la bibliothèque de maps de BakkesMod (celle qu'utilise le plugin « Workshop Map Loader & Downloader »).
// Les fichiers restent sur le CDN de BakkesPlugins : le registre ne fait que les référencer.
//
// Usage : node registry/scripts/import-bakkesplugins.mjs

import { decode, get, pool, SUPPORTED_EXTS, text, writeSource } from './lib.mjs'

const BASE = 'https://bakkesplugins.com'
const CDN = 'https://cdn.bakkesplugins.com/'

const stripSvg = (s) => s.replace(/<svg[\s\S]*?<\/svg>/g, '')

/** Cartes d'une page de liste. */
function parseCards(html) {
  const cards = []
  for (const m of html.matchAll(/<a href="\/maps\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const body = stripSvg(m[2])
    const name = body.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1]
    if (!name) continue
    const counter = (label) => body.match(new RegExp(`>([\\d.,]+[KM]?)(?:<!-- -->)? ${label}<`))?.[1] ?? null
    cards.push({
      num: Number(m[1]),
      name: decode(name),
      author: decode(body.match(/<span class="truncate text-sm font-medium"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? 'Inconnu'),
      description: decode(body.match(/<p class="mb-3 line-clamp-3[^"]*">([\s\S]*?)<\/p>/)?.[1] ?? '').replace(/^No description provided\.?$/i, ''),
      thumbnail: body.match(/<img[^>]*src="(https:\/\/cdn\.bakkesplugins\.com\/[^"]+)"/)?.[1] ?? null,
      tags: [...body.matchAll(/<span class="rounded-full border[^"]*"[^>]*>([^<]+)<\/span>/g)].map((t) => decode(t[1])),
      rating: Number(body.match(/title="([\d.]+) out of 5"/)?.[1]) || null,
      downloads: counter('downloads'),
      updated: body.match(/Updated (?:<!-- -->)?([\d/]+)/)?.[1] ?? null
    })
  }
  return cards
}

/** Dernière version publiée : URL CDN du fichier. */
function parseLatestVersion(html) {
  const nav = html.indexOf('<nav aria-label="Map detail tabs"')
  const end = html.indexOf('</section>', nav)
  if (nav < 0 || end < 0) return null
  const articles = [...html.slice(nav, end).matchAll(/<article[\s\S]*?<\/article>/g)].map((a) => a[0])
  const latest = articles.find((a) => a.includes('>Latest</span>')) ?? articles[0]
  if (!latest) return null
  const url = latest.match(/href="(https:\/\/cdn\.bakkesplugins\.com\/[^"]+)"/)?.[1]
  const version = latest.match(/<span class="text-lg font-semibold text-gray-900">([^<]+)<\/span>/)?.[1]
  return url ? { url: decode(url), version: version ? decode(version) : null } : null
}

/** Taille exacte via HEAD sur le CDN, et nom de fichier sans le préfixe de hash. */
async function probe(url) {
  const res = await get(url, { method: 'HEAD' })
  const raw = decodeURIComponent(url.slice(CDN.length).split('/').pop() ?? '')
  return {
    ok: res.ok,
    size: Number(res.headers.get('content-length')) || null,
    filename: raw.replace(/^[0-9a-f]{32}-/, '') || null
  }
}

async function main() {
  console.log('Liste des maps…')
  const first = await text(`${BASE}/maps`)
  const last = Math.max(1, ...[...first.matchAll(/\/maps\?page=(\d+)/g)].map((m) => Number(m[1])))
  const pages = [first]
  for (let p = 2; p <= last; p++) pages.push(await text(`${BASE}/maps?page=${p}`))
  const cards = [...new Map(pages.flatMap(parseCards).map((c) => [c.num, c])).values()]
  console.log(`${cards.length} maps sur ${last} pages`)

  const skipped = []
  const maps = await pool(cards, 3, async (c, i) => {
    process.stdout.write(`\r${i + 1}/${cards.length}`)
    const latest = parseLatestVersion(await text(`${BASE}/maps/${c.num}?tab=versions`))
    if (!latest) return skipped.push(`${c.num} ${c.name} : aucune version`), null
    const file = await probe(latest.url)
    const ext = file.filename?.split('.').pop()?.toLowerCase()
    if (!file.ok || !SUPPORTED_EXTS.includes(ext)) {
      return skipped.push(`${c.num} ${c.name} : ${file.ok ? `format .${ext}` : 'fichier injoignable'}`), null
    }
    const settings = c.description.match(/\n\s*Recommended Settings\s*\n([\s\S]*)$/i)
    return {
      id: `bakkesplugins-${c.num}`,
      name: c.name,
      author: c.author,
      summary: c.description.split('\n')[0].slice(0, 160),
      description: settings ? c.description.slice(0, settings.index).trim() : c.description,
      recommendedSettings: settings ? settings[1].trim() : undefined,
      tags: c.tags,
      thumbnail: c.thumbnail,
      homepage: `${BASE}/maps/${c.num}`,
      source: 'bakkesplugins',
      version: latest.version ?? undefined,
      download: { url: latest.url, filename: file.filename, size: file.size }
    }
  })

  if (skipped.length) console.warn(`\nIgnorées (${skipped.length}) :\n  ` + skipped.join('\n  '))
  await writeSource('bakkesplugins', 'BakkesPlugins', maps.filter(Boolean))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

