// Icône dans la zone de notification : fermer la fenêtre garde l'app en arrière-plan
// (la restauration « à la fermeture » n'a lieu qu'en quittant vraiment).

import { Menu, Tray, nativeImage } from 'electron'
import type { GameStatus } from '../shared/types'
import { t } from '../shared/i18n'

export interface TrayActions {
  show(): void
  restore(): void
  quit(): void
}

let tray: Tray | null = null
let actions: TrayActions | null = null

function buildMenu(status: GameStatus | null) {
  const loaded = status?.slot.kind === 'custom' ? status.slot.mapName : status?.slot.kind === 'unknown' ? t('map d’un autre outil') : null
  return Menu.buildFromTemplate([
    { label: t('Ouvrir RL Maps'), click: () => actions?.show() },
    { type: 'separator' },
    loaded
      ? { label: t("Restaurer l'original ({name})", { name: loaded }), click: () => actions?.restore() }
      : { label: t('Aucune map custom chargée'), enabled: false },
    { type: 'separator' },
    { label: t('Quitter'), click: () => actions?.quit() }
  ])
}

export function createTray(iconPath: string, a: TrayActions) {
  actions = a
  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('RL Maps')
  tray.setContextMenu(buildMenu(null))
  tray.on('click', () => a.show())
}

/** Met à jour l'infobulle et le menu selon la map chargée. */
export function updateTray(status: GameStatus) {
  if (!tray) return
  tray.setToolTip(status.slot.kind === 'custom' ? `RL Maps — ${status.slot.mapName} (${status.slot.arena})` : 'RL Maps')
  tray.setContextMenu(buildMenu(status))
}
