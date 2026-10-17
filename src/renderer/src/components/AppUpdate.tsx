import { useEffect, useState } from 'react'
import { ArrowDownToLine, LoaderCircle, RotateCw } from 'lucide-react'
import type { AppUpdateState } from '../../../shared/types'

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState | null>(null)
  useEffect(() => {
    void window.api.getAppUpdate().then(setState)
    return window.api.onAppUpdate(setState)
  }, [])
  return state
}

/** Pastille dans la barre de titre quand une nouvelle version de l'app est en route ou prête. */
export function AppUpdatePill() {
  const state = useAppUpdate()
  if (!state) return null

  const pill = 'no-drag inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition'

  if (state.kind === 'downloading') {
    return (
      <span className={`${pill} bg-surface-2 text-muted`} title={`Téléchargement de la version ${state.version}`}>
        <LoaderCircle className="size-3.5 animate-spin" /> Mise à jour {state.percent ?? 0} %
      </span>
    )
  }
  if (state.kind === 'ready') {
    return (
      <button
        className={`${pill} bg-ok text-bg hover:brightness-110`}
        title="Redémarre l'app pour installer la nouvelle version (sinon, elle s'installera à la prochaine fermeture)"
        onClick={() => void window.api.installAppUpdate()}
      >
        <RotateCw className="size-3.5" /> v{state.version} prête · Redémarrer
      </button>
    )
  }
  if (state.kind === 'portable' && state.url) {
    return (
      <button className={`${pill} bg-blue text-white hover:bg-blue-strong`} onClick={() => void window.api.openExternal(state.url!)}>
        <ArrowDownToLine className="size-3.5" /> v{state.version} disponible
      </button>
    )
  }
  return null
}

/** Texte d'état pour la section « À propos » des réglages. */
export function describeAppUpdate(state: AppUpdateState | null): string {
  switch (state?.kind) {
    case 'checking':
      return 'Recherche de mises à jour…'
    case 'downloading':
      return `Téléchargement de la version ${state.version} (${state.percent ?? 0} %)…`
    case 'ready':
      return `La version ${state.version} est prête : redémarre l'app pour l'installer.`
    case 'portable':
      return `La version ${state.version} est disponible. La version portable ne se met pas à jour seule : télécharge-la depuis la page des releases.`
    case 'error':
      return `Vérification impossible : ${state.error}`
    default:
      return 'Tu as la dernière version.'
  }
}
