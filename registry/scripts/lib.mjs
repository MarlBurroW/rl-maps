// Outils partagés par les importeurs de sources.

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const SOURCES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sources')
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) rl-maps-registry-bot (+https://github.com/MarlBurroW/rl-maps)'

export async function get(url, init = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: { 'user-agent': UA, ...init.headers } })
      if ((res.status >= 500 || res.status === 429) && attempt < 4) throw new Error(`HTTP ${res.status}`)
      return res
    } catch (err) {
      if (attempt >= 4) throw err
      await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
  }
}

export async function text(url) {
  const res = await get(url)
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return res.text()
}

export const decode = (s) =>
  s
    .replace(/<!-- -->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Exécute fn sur chaque élément avec une concurrence limitée (on reste poli avec les sites). */
export async function pool(items, concurrency, fn) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await fn(items[i], i)
      }
    })
  )
  return results
}

/** Rend les ids uniques (suffixe -2, -3…) puis écrit registry/sources/<id>.json. */
export async function writeSource(id, name, maps) {
  const ids = new Set()
  for (const m of maps) {
    const base = m.id
    for (let i = 2; ids.has(m.id); i++) m.id = `${base}-${i}`
    ids.add(m.id)
  }
  const index = {
    $schema: '../schema.json',
    version: 1,
    name,
    updatedAt: new Date().toISOString(),
    maps: maps.sort((a, b) => a.name.localeCompare(b.name))
  }
  const file = path.join(SOURCES_DIR, `${id}.json`)
  await writeFile(file, JSON.stringify(index, null, 2) + '\n')

  const exts = {}
  for (const m of maps) {
    const ext = m.download.filename?.split('.').pop()?.toLowerCase() ?? '?'
    exts[ext] = (exts[ext] ?? 0) + 1
  }
  console.log(`\n${path.relative(process.cwd(), file)} : ${maps.length} maps. Formats :`, exts)
}

export const SUPPORTED_EXTS = ['zip', 'udk', 'upk']
