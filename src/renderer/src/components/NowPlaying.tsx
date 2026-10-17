import { FolderSearch, RotateCcw, TriangleAlert } from 'lucide-react'
import { playHint, useApp } from '../state'
import { Thumb } from './Thumb'
import { Button } from './Button'

/** Barre persistante en bas : quelle map est chargée, dans quelle arène, et comment revenir à l'original. */
export function NowPlaying({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { status, library, busy, restore } = useApp()
  if (!status) return <footer className="h-[72px] shrink-0 border-t border-line bg-surface" />

  const running = (
    <span className="flex items-center gap-2 text-[13px] text-muted">
      <span className={`size-2 rounded-full ${status.running ? 'bg-ok shadow-[0_0_8px] shadow-ok' : 'bg-faint'}`} />
      {status.running ? 'Rocket League est lancé' : 'Rocket League fermé'}
    </span>
  )

  let content
  if (!status.valid) {
    content = (
      <>
        <div className="flex size-11 items-center justify-center rounded-lg bg-warn/10">
          <FolderSearch className="size-5 text-warn" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Rocket League introuvable</p>
          <p className="text-[13px] text-muted">Indique le dossier d'installation du jeu pour pouvoir charger des maps.</p>
        </div>
        <Button variant="primary" onClick={onOpenSettings}>
          Configurer
        </Button>
      </>
    )
  } else if (status.slot.kind === 'custom') {
    const { mapId, mapName, arena } = status.slot
    const map = library.find((m) => m.id === mapId)
    content = (
      <>
        <Thumb src={map?.thumbnail} alt={mapName} ratio={false} className="h-11 w-20 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            <span className="mr-2 rounded bg-orange/15 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-orange uppercase">En jeu</span>
            {mapName}
          </p>
          <p className="truncate text-[13px] text-muted">{playHint(arena)}</p>
        </div>
        {running}
        <Button icon={<RotateCcw className="size-4" />} busy={busy === 'restore'} onClick={() => void restore()}>
          Restaurer l'original
        </Button>
      </>
    )
  } else if (status.slot.kind === 'unknown') {
    content = (
      <>
        <div className="flex size-11 items-center justify-center rounded-lg bg-warn/10">
          <TriangleAlert className="size-5 text-warn" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Une map chargée par un autre outil est en place</p>
          <p className="truncate text-[13px] text-muted">Le fichier d'origine est sauvegardé : tu peux le restaurer quand tu veux.</p>
        </div>
        {running}
        <Button icon={<RotateCcw className="size-4" />} busy={busy === 'restore'} onClick={() => void restore()}>
          Restaurer l'original
        </Button>
      </>
    )
  } else {
    content = (
      <>
        <div className="flex size-11 items-center justify-center rounded-lg bg-surface-2">
          <span className="size-2.5 rounded-full bg-ok" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Aucune map custom chargée</p>
          <p className="text-[13px] text-muted">Arènes d'origine en place, tu peux jouer en ligne normalement.</p>
        </div>
        {running}
      </>
    )
  }

  return <footer className="flex h-[72px] shrink-0 items-center gap-4 border-t border-line bg-surface px-5">{content}</footer>
}
