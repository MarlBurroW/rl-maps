// Vérifie les registres de registry/sources/ avant une PR : structure, ids uniques, URLs https.
// Usage : node registry/scripts/validate.mjs [--check-links]

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { SOURCES_DIR, SUPPORTED_EXTS } from './lib.mjs'

const checkLinks = process.argv.includes('--check-links')
const errors = []
const allIds = new Map()
let total = 0

for (const file of (await readdir(SOURCES_DIR)).filter((f) => f.endsWith('.json'))) {
  const index = JSON.parse(await readFile(path.join(SOURCES_DIR, file), 'utf8'))
  if (index.version !== 1) errors.push(`${file} : version doit valoir 1`)
  if (!Array.isArray(index.maps)) {
    errors.push(`${file} : "maps" doit être un tableau`)
    continue
  }

  for (const [i, m] of index.maps.entries()) {
    const where = `${file} maps[${i}] (${m?.id ?? '?'})`
    if (typeof m.id !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(m.id)) errors.push(`${where} : id invalide`)
    else if (allIds.has(m.id)) errors.push(`${where} : id déjà utilisé dans ${allIds.get(m.id)}`)
    allIds.set(m.id, file)
    if (typeof m.name !== 'string' || !m.name.trim()) errors.push(`${where} : name manquant`)
    if (typeof m.author !== 'string') errors.push(`${where} : author manquant`)
    if (!Array.isArray(m.tags)) errors.push(`${where} : tags doit être un tableau`)
    if (!/^https:\/\//.test(m.download?.url ?? '')) errors.push(`${where} : download.url doit être en https`)
    if (m.thumbnail != null && !/^https:\/\//.test(m.thumbnail)) errors.push(`${where} : thumbnail doit être en https`)
    const ext = (m.download?.filename ?? '').split('.').pop()?.toLowerCase()
    if (m.download?.filename && !SUPPORTED_EXTS.includes(ext)) errors.push(`${where} : format non supporté (${ext})`)
  }
  total += index.maps.length

  if (checkLinks) {
    for (const m of index.maps) {
      const res = await fetch(m.download.url, { method: 'HEAD', redirect: 'follow' }).catch((e) => ({ ok: false, status: e.message }))
      if (!res.ok) errors.push(`${m.id} : lien injoignable (${res.status})`)
    }
  }
}

if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join('\n'))
  process.exit(1)
}
console.log(`✓ ${total} maps valides`)
