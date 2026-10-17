// Opérations fichier sur le dossier du jeu, avec repli UAC si Windows refuse l'écriture.

import { copyFile, rename, rm, writeFile, mkdtemp } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { t } from '../../shared/i18n'

export type FileOp = { op: 'copy'; from: string; to: string } | { op: 'remove'; path: string }

export class GameFileError extends Error {}

const TMP_SUFFIX = '.rlmaps-tmp'

/** Copie via un fichier temporaire puis renommage : la cible n'est jamais à moitié écrite. */
async function atomicCopy(from: string, to: string): Promise<void> {
  const tmp = to + TMP_SUFFIX
  await copyFile(from, tmp)
  try {
    await rename(tmp, to)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}

async function runDirect(ops: FileOp[]): Promise<void> {
  for (const o of ops) {
    if (o.op === 'copy') await atomicCopy(o.from, o.to)
    else await rm(o.path, { force: true })
  }
}

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ops = Get-Content -Raw -LiteralPath $args[0] | ConvertFrom-Json
foreach ($o in $ops) {
  if ($o.op -eq 'copy') {
    $tmp = $o.to + '${TMP_SUFFIX}'
    Copy-Item -LiteralPath $o.from -Destination $tmp -Force
    Move-Item -LiteralPath $tmp -Destination $o.to -Force
  } else {
    Remove-Item -LiteralPath $o.path -Force -ErrorAction SilentlyContinue
  }
}
`

function powershell(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ...args], { windowsHide: true }, (err, _out, stderr) =>
      err ? reject(new Error(stderr.trim() || err.message)) : resolve()
    )
  })
}

/** Rejoue les opérations dans un PowerShell élevé (une invite UAC). */
async function runElevated(ops: FileOp[]): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'rlmaps-'))
  const opsFile = path.join(dir, 'ops.json')
  const scriptFile = path.join(dir, 'ops.ps1')
  await writeFile(opsFile, JSON.stringify(ops), 'utf8')
  await writeFile(scriptFile, PS_SCRIPT, 'utf8')
  const quote = (s: string) => `'${s.replace(/'/g, "''")}'`
  try {
    await powershell([
      `$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden ` +
        `-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${quote(`"${scriptFile}"`)},${quote(`"${opsFile}"`)}; ` +
        `exit $p.ExitCode`
    ])
  } catch (err) {
    const msg = (err as Error).message
    if (/annul|cancel/i.test(msg)) throw new GameFileError(t("Autorisation administrateur refusée : la map n'a pas été modifiée."))
    throw new GameFileError(t("Échec de l'écriture en mode administrateur : {msg}", { msg }))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Sous Windows, EPERM signifie soit « pas les droits », soit « fichier verrouillé ». On distingue les deux. */
async function canWriteDir(dir: string): Promise<boolean> {
  const probe = path.join(dir, `.rlmaps-probe-${process.pid}`)
  try {
    await writeFile(probe, '')
    await rm(probe, { force: true })
    return true
  } catch {
    return false
  }
}

const locked = () =>
  new GameFileError(t('Rocket League utilise actuellement ce fichier. Reviens au menu principal du jeu (ou ferme-le) puis réessaie.'))

export async function applyOps(ops: FileOp[]): Promise<void> {
  try {
    await runDirect(ops)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EBUSY') throw locked()
    if (code === 'EPERM' || code === 'EACCES') {
      const first = ops[0]
      const dir = path.dirname(first.op === 'copy' ? first.to : first.path)
      if (await canWriteDir(dir)) throw locked()
      if (process.platform === 'win32') return runElevated(ops)
    }
    throw new GameFileError((err as Error).message)
  }
}
