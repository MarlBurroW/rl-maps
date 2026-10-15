import { execFile } from 'node:child_process'

/** Rocket League est-il lancé ? (RocketLeague.exe sous Windows/Proton) */
export function isGameRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile(
        'tasklist',
        ['/FI', 'IMAGENAME eq RocketLeague.exe', '/FO', 'CSV', '/NH'],
        { windowsHide: true },
        (err, out) => resolve(!err && /RocketLeague\.exe/i.test(out))
      )
    } else {
      execFile('pgrep', ['-f', 'RocketLeague.exe'], (err) => resolve(!err))
    }
  })
}
