// Construit registry/sources/vgm.json à partir de VGM (videogamemods.com, ex-rocketleaguemods.com).
// API publique de navigation + fiche de chaque mod (payload Next.js) pour les fichiers.
// On ne garde que les zips qui contiennent réellement une map (.udk/.upk hors pack de textures).
//
// Usage : node registry/scripts/import-vgm.mjs

import { decode, get, pool, slug, text, writeSource } from './lib.mjs'
import { findMainPackage, packageName, withImports, zipEntries } from './scan-imports.mjs'
import { WORKSHOP_TEXTURE_PACKAGES } from '../../src/shared/compat.ts'

const SITE = 'https://videogamemods.com'
const FILES = 'https://uploads.videogamemods.com/'

/** Catégories « maps » de la section Rocket League, et le tag affiché dans l'app */
const CATEGORIES = {
  '785ff8d2-c550-4684-8e06-154c431c2da3': 'Arena',
  'aaf38682-d622-491a-be6c-d103096b4ce2': null, // « Other Maps » : pas de tag
  '30109edc-4431-4bd8-b762-dbcd7cf6a5d8': 'Race',
  'e6104c96-d566-4c32-91ac-e9fe36edba54': 'Training'
}

/** Outils, modèles de mapping et packs : pas des maps jouables */
const NOT_MAPS = new Set([
  'workshop-textures',
  'freeplay-map-selector',
  'template-map-for-rl-mapping',
  'countdown-timer-template',
  'spawn-point-template',
  'goals-example-map',
  'green-map-mod-for-edits',
  'udk-2015-simple-setup'
])

async function browse(categoryId) {
  const mods = []
  for (let page = 1; ; page++) {
    const res = await get(`${SITE}/api/mods/browse?page=${page}&gameSlug=rocketleague&communitySlug=vgm&categoryIds=${categoryId}`)
    const data = await res.json()
    if (!data.success) throw new Error(`browse ${categoryId} : ${data.error}`)
    mods.push(...data.mods)
    if (page >= data.totalPages) return mods
  }
}

/** Données de la fiche (description, fichiers) depuis le payload RSC de la page. */
async function details(slugName) {
  const html = await text(`${SITE}/vgm/rocketleague/mods/${slugName}`)
  const payload = [...html.matchAll(/self\.__next_f\.push\(\[1,(".*?")\]\)<\/script>/gs)].map((m) => JSON.parse(m[1])).join('')
  const files = JSON.parse(payload.match(/"files":(\[.*?\]),"game"/s)?.[1] ?? '[]')
  const raw = payload.match(/"description":"((?:[^"\\]|\\.)*)","install_guide"/s)?.[1]
  let description = raw ? JSON.parse(`"${raw}"`) : ''
  // Texte long : Next.js le stocke à part et met une référence « $2d » (bloc « 2d:T<taille hexa>,<texte> »)
  const ref = description.match(/^\$([0-9a-z]+)$/)?.[1]
  if (ref) {
    const head = payload.match(new RegExp(`(?<![0-9a-z])${ref}:T([0-9a-f]+),`))
    if (head) {
      const start = Buffer.byteLength(payload.slice(0, head.index + head[0].length))
      description = Buffer.from(payload).subarray(start, start + parseInt(head[1], 16)).toString('utf8')
    } else description = ''
  }
  return { files, description: decode(description) }
}

async function main() {
  console.log('Liste des maps…')
  const bySlug = new Map()
  for (const [id, tag] of Object.entries(CATEGORIES)) {
    for (const mod of await browse(id)) {
      const entry = bySlug.get(mod.slug) ?? { mod, tags: new Set() }
      if (tag) entry.tags.add(tag)
      bySlug.set(mod.slug, entry)
    }
  }
  const candidates = [...bySlug.values()].filter(({ mod }) => !NOT_MAPS.has(mod.slug) && !mod.is_paid)
  console.log(`${candidates.length} candidates`)

  const skipped = []
  const maps = await pool(candidates, 4, async ({ mod, tags }, i) => {
    process.stdout.write(`\r${i + 1}/${candidates.length}`)
    try {
      const { files, description } = await details(mod.slug)
      const file = files.find((f) => f.is_primary) ?? files[0]
      if (!file || !/\.zip$/i.test(file.filename)) return skipped.push(`${mod.title} : ${file?.filename ?? 'aucun fichier'}`), null

      const url = FILES + file.file_path
      const packages = (await zipEntries(url, file.file_size)).filter((e) => /\.(udk|upk)$/i.test(e.name))
      const main = packages.length ? (await findMainPackage(url, packages)).entry : null
      if (!main || WORKSHOP_TEXTURE_PACKAGES.has(packageName(main.name))) return skipped.push(`${mod.title} : pas de map dans le zip`), null

      return {
        id: `vgm-${slug(mod.slug)}`,
        name: decode(mod.title),
        author: mod.user?.display_name ?? mod.user?.username ?? 'Inconnu',
        summary: description.split('\n')[0].slice(0, 160),
        description,
        tags: [...tags].sort(),
        thumbnail: mod.thumbnail_url ?? null,
        homepage: `${SITE}/vgm/rocketleague/mods/${mod.slug}`,
        source: 'vgm',
        version: mod.version ? `v${String(mod.version).replace(/^v+/i, '')}` : undefined,
        download: { url, filename: file.original_filename ?? file.filename, size: file.file_size }
      }
    } catch (err) {
      skipped.push(`${mod.title} : ${err.message}`)
      return null
    }
  })

  if (skipped.length) console.warn(`\nIgnorés (${skipped.length}) :\n  ` + skipped.join('\n  '))
  await writeSource('vgm', 'VGM', await withImports('vgm', maps.filter(Boolean)))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
