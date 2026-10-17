import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import yazl from 'yazl'
import { afterEach } from 'vitest'

const dirs: string[] = []

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'rlmaps-test-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

/** Fausse installation de Rocket League avec un Labs_Underpass_P.upk d'origine (et Utopia Retro si demandé). */
export async function fakeInstall(original = 'ORIGINAL-UNDERPASS', utopia?: string): Promise<string> {
  const root = path.join(await tempDir(), 'rocketleague')
  const cooked = path.join(root, 'TAGame', 'CookedPCConsole')
  await mkdir(cooked, { recursive: true })
  await writeFile(path.join(cooked, 'Labs_Underpass_P.upk'), original)
  if (utopia !== undefined) await writeFile(path.join(cooked, 'Labs_Utopia_P.upk'), utopia)
  return root
}

/**
 * Construit un paquet UE3 minimal (en-tête, table des noms, table des imports).
 * imports : [classe, outer (0 = racine, -n = n-ième import), nom]
 */
export function makePackage(names: string[], imports: [string, number, string][]): Buffer {
  const fstr = (s: string) => {
    const b = Buffer.alloc(4 + s.length + 1)
    b.writeInt32LE(s.length + 1, 0)
    b.write(s, 4, 'latin1')
    return b
  }
  const idx = (n: string) => {
    const i = names.indexOf(n)
    if (i < 0) throw new Error(`nom absent : ${n}`)
    return i
  }
  const nameTable = Buffer.concat(names.map((n) => Buffer.concat([fstr(n), Buffer.alloc(8)])))
  const importTable = Buffer.concat(
    imports.map(([cls, outer, name]) => {
      const b = Buffer.alloc(28)
      b.writeInt32LE(idx('Core'), 0)
      b.writeInt32LE(idx(cls), 8)
      b.writeInt32LE(outer, 16)
      b.writeInt32LE(idx(name), 20)
      return b
    })
  )
  const folder = fstr('None')
  const summary = Buffer.alloc(12 + folder.length + 4 + 6 * 4 + 64)
  const nameOffset = summary.length
  const importOffset = nameOffset + nameTable.length
  summary.writeUInt32LE(0x9e2a83c1, 0)
  summary.writeUInt16LE(868, 4)
  summary.writeInt32LE(importOffset + importTable.length, 8)
  folder.copy(summary, 12)
  let o = 12 + folder.length
  for (const v of [0, names.length, nameOffset, 0, 0, imports.length, importOffset]) {
    summary.writeInt32LE(v, o)
    o += 4
  }
  return Buffer.concat([summary, nameTable, importTable])
}

/**
 * Crée un zip. yazl refuse les chemins en « ../ » : pour simuler une archive malveillante,
 * on écrit un nom de même longueur puis on le remplace dans les octets (le CRC ne couvre pas les noms).
 */
export async function makeZip(file: string, entries: Record<string, string | Buffer>): Promise<string> {
  const zip = new yazl.ZipFile()
  const patches: [string, string][] = []
  for (const [name, content] of Object.entries(entries)) {
    const safe = name.replace(/\.\./g, 'zz')
    if (safe !== name) patches.push([safe, name])
    zip.addBuffer(Buffer.isBuffer(content) ? content : Buffer.from(content), safe)
  }
  zip.end()
  const chunks: Buffer[] = []
  for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer)
  const buf = Buffer.concat(chunks)
  for (const [from, to] of patches) {
    const fromBuf = Buffer.from(from)
    for (let i = buf.indexOf(fromBuf); i !== -1; i = buf.indexOf(fromBuf, i + 1)) Buffer.from(to).copy(buf, i)
  }
  await writeFile(file, buf)
  return file
}
