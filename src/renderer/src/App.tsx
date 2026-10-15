import { useCallback, useMemo, useState } from 'react'
import { AppProvider, useApp, type Item } from './state'
import { TitleBar, type Tab } from './components/TitleBar'
import { NowPlaying } from './components/NowPlaying'
import { MapDetail } from './components/MapDetail'
import { DropOverlay } from './components/DropOverlay'
import { MarketPage } from './pages/Market'
import { LibraryPage } from './pages/Library'
import { SettingsPage } from './pages/Settings'

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}

function Shell() {
  const { library, market, marketItem, localItem, importFiles } = useApp()
  const [tab, setTab] = useState<Tab>('market')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  // La fiche ouverte est recalculée depuis l'état courant (progression, installation, chargement…)
  const selected = useMemo<Item | null>(() => {
    if (!selectedKey) return null
    if (selectedKey.startsWith('m:')) {
      const m = market?.maps.find((x) => `m:${x.sourceId}:${x.id}` === selectedKey)
      return m ? marketItem(m) : null
    }
    const l = library.find((x) => `l:${x.id}` === selectedKey)
    return l ? localItem(l) : null
  }, [selectedKey, market, library, marketItem, localItem])

  const open = useCallback((item: Item) => setSelectedKey(item.key), [])
  const onFiles = useCallback(
    (paths: string[]) => {
      setTab('library')
      void importFiles(paths)
    },
    [importFiles]
  )

  return (
    <div className="flex h-full flex-col">
      <TitleBar tab={tab} onTab={setTab} libraryCount={library.length} />
      <main className="min-h-0 flex-1">
        {tab === 'market' && <MarketPage onOpen={open} />}
        {tab === 'library' && <LibraryPage onOpen={open} onBrowse={() => setTab('market')} />}
        {tab === 'settings' && <SettingsPage />}
      </main>
      <NowPlaying onOpenSettings={() => setTab('settings')} />
      {selected && <MapDetail item={selected} onClose={() => setSelectedKey(null)} />}
      <DropOverlay onFiles={onFiles} />
    </div>
  )
}
