// Construit registry/sources/lethamyr.json à partir du catalogue public de lethamyr.com.
// Les fichiers ne sont pas ré-hébergés : le registre pointe vers les liens de téléchargement
// officiels (Google Drive) publiés par l'auteur.
// (L'API /api/v1/maps du site ne donne ni identifiant ni catégories : on lit donc les pages.)
//
// Usage : node registry/scripts/import-lethamyr.mjs

import { decode, get, pool, slug, text, writeSource } from './lib.mjs'
import { withImports } from './scan-imports.mjs'

const BASE = 'https://lethamyr.com'

/** Cartes d'une page de liste : [{ num, name, summary, thumbnail }] */
function parseCards(html) {
  const cards = []
  for (const m of html.matchAll(/<a href="\/maps\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const body = m[2]
    const name = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)
    if (!name) continue
    const img = body.match(/<img[\s\S]*?src="([^"]+)"/)
    cards.push({
      num: Number(m[1]),
      name: decode(name[1]),
      summary: decode(body.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? ''),
      thumbnail: img ? new URL(img[1], BASE).href : null
    })
  }
  return cards
}

async function listPages(query = '') {
  const first = await text(`${BASE}/maps${query}`)
  const last = Math.max(1, ...[...first.matchAll(/[?&]page=(\d+)/g)].map((m) => Number(m[1])))
  const htmls = [first]
  for (let p = 2; p <= last; p++) htmls.push(await text(`${BASE}/maps${query}${query ? '&' : '?'}page=${p}`))
  return htmls.flatMap(parseCards)
}

function parseDetail(html) {
  const about = html.match(/About the map\s*<\/h\d>([\s\S]*?)<\/div>/i)
  const settings = html.match(/Recommended Settings\s*<\/h\d>([\s\S]*?)<\/div>/i)
  return {
    description: about ? decode(about[1]) : '',
    recommendedSettings: settings ? decode(settings[1]) : ''
  }
}

const driveId = (url) => url.match(/drive\.google\.com\/file\/d\/([\w-]+)/)?.[1] ?? url.match(/[?&]id=([\w-]+)/)?.[1] ?? null

/** Résout /maps/N/download -> lien Drive, puis sonde nom et taille du fichier (1 octet). */
async function resolveDownload(num) {
  const res = await get(`${BASE}/maps/${num}/download`, { redirect: 'manual' })
  const location = res.headers.get('location')
  if (!location) return null
  const id = driveId(location)
  if (!id) return { url: location, filename: null, size: null }

  const probe = await get(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, {
    headers: { range: 'bytes=0-0' }
  })
  await probe.body?.cancel()
  const filename = (probe.headers.get('content-disposition') ?? '').match(/filename="([^"]+)"/)?.[1] ?? null
  // Lien mort, privé ou dossier Drive : inutilisable par l'app
  if (!probe.ok || !filename) {
    console.warn(`\n  ignorée : /maps/${num} (Drive HTTP ${probe.status})`)
    return null
  }
  const size = Number((probe.headers.get('content-range') ?? '').split('/')[1]) || null
  return { url: `https://drive.google.com/file/d/${id}/view`, filename, size }
}

async function main() {
  console.log('Liste des maps…')
  const cards = [...new Map((await listPages()).map((c) => [c.num, c])).values()]
  console.log(`${cards.length} maps trouvées`)

  console.log('Catégories…')
  const home = await text(`${BASE}/maps`)
  const filters = [...new Set([...home.matchAll(/\/maps\?filter=([^"&]+)"/g)].map((m) => m[1]))]
  const tags = new Map()
  for (const f of filters) {
    const tag = decodeURIComponent(f).replace(/\+/g, ' ')
    for (const c of await listPages(`?filter=${f}`)) {
      if (!tags.has(c.num)) tags.set(c.num, new Set())
      tags.get(c.num).add(tag)
    }
  }

  console.log('Détails et liens de téléchargement…')
  const maps = await pool(cards, 4, async (c, i) => {
    const [detail, download] = await Promise.all([text(`${BASE}/maps/${c.num}`).then(parseDetail), resolveDownload(c.num)])
    process.stdout.write(`\r${i + 1}/${cards.length}`)
    if (!download) return null
    return {
      // Ids stables : ils servent à reconnaître les maps déjà installées
      id: `lethamyr-${slug(c.name)}`,
      name: c.name,
      author: 'Lethamyr',
      summary: c.summary,
      description: detail.description || c.summary,
      recommendedSettings: detail.recommendedSettings || undefined,
      tags: [...(tags.get(c.num) ?? [])].sort(),
      thumbnail: c.thumbnail,
      homepage: `${BASE}/maps/${c.num}`,
      source: 'lethamyr',
      download
    }
  })

  await writeSource('lethamyr', 'Lethamyr', await withImports('lethamyr', maps.filter(Boolean)))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
