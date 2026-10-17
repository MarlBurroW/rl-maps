// Ajoute les dépendances (`imports`) aux registres existants, sans relancer les imports complets.
// Utile après un ajout manuel dans community.json.
// Usage : node registry/scripts/scan.mjs [source...]

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { SOURCES_DIR, writeSource } from './lib.mjs'
import { withImports } from './scan-imports.mjs'

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['lethamyr', 'bakkesplugins', 'community']
for (const id of ids) {
  const index = JSON.parse(await readFile(path.join(SOURCES_DIR, `${id}.json`), 'utf8'))
  console.log(`${id} : ${index.maps.length} maps`)
  await writeSource(id, index.name, await withImports(id, index.maps))
}
