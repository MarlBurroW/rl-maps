import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const STRING = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"`
const CALL = new RegExp(String.raw`\b(?:t|tk)\(\s*(?:${STRING})`, 'g')
const PLURAL = new RegExp(String.raw`\bplural\(\s*[^,]+,\s*(?:${STRING})\s*,\s*(?:${STRING})`, 'g')

const unescape = (s: string) => s.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n')

/** Toutes les clés de traduction littérales du code : t('…'), tk('…'), plural(n, '…', '…'). */
export function extractKeys(dir = path.join(import.meta.dirname, '..', 'src')): Set<string> {
  const keys = new Set<string>()
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(f) && !f.startsWith('i18n')) {
        const src = readFileSync(p, 'utf8')
        for (const m of src.matchAll(CALL)) keys.add(unescape(m[1] ?? m[2]))
        for (const m of src.matchAll(PLURAL)) [m[1] ?? m[2], m[3] ?? m[4]].forEach((k) => keys.add(unescape(k)))
      }
    }
  }
  walk(dir)
  return keys
}
