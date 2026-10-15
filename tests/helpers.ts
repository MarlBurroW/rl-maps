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

/** Fausse installation de Rocket League avec un Labs_Underpass_P.upk d'origine. */
export async function fakeInstall(original = 'ORIGINAL-UNDERPASS'): Promise<string> {
  const root = path.join(await tempDir(), 'rocketleague')
  const cooked = path.join(root, 'TAGame', 'CookedPCConsole')
  await mkdir(cooked, { recursive: true })
  await writeFile(path.join(cooked, 'Labs_Underpass_P.upk'), original)
  return root
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
