import { describe, expect, it } from 'vitest'
import { EN } from '../src/shared/i18n.en'
import { extractKeys } from './i18n-keys'
import { plural, resolveLang, setLang, t } from '../src/shared/i18n'

describe('traductions', () => {
  it('chaque texte de l’interface a sa traduction anglaise', () => {
    const missing = [...extractKeys()].filter((k) => !(k in EN))
    expect(missing).toEqual([])
  })

  it('les variables sont conservées dans les traductions', () => {
    for (const [fr, en] of Object.entries(EN)) {
      const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      expect(vars(en), fr).toEqual(vars(fr))
    }
  })

  it('traduit, interpole et gère le pluriel', () => {
    setLang('en')
    try {
      expect(t('Installer')).toBe(EN['Installer'])
      expect(t('Texte inconnu')).toBe('Texte inconnu')
      expect(plural(1, '{n} map installée · {size} sur le disque. Glisse un fichier dans la fenêtre pour en ajouter.', '{n} maps installées · {size} sur le disque. Glisse un fichier dans la fenêtre pour en ajouter.', { size: '1 MB' })).toMatch(/^1 /)
    } finally {
      setLang('fr')
    }
    expect(t('Bonjour {name}', { name: 'Marl' })).toBe('Bonjour Marl')
  })

  it('choisit la langue : réglage explicite, sinon celle du système', () => {
    expect(resolveLang('en', 'fr-FR')).toBe('en')
    expect(resolveLang('auto', 'fr-FR')).toBe('fr')
    expect(resolveLang(undefined, 'fr')).toBe('fr')
    expect(resolveLang('auto', 'en-US')).toBe('en')
    expect(resolveLang('auto', 'de-DE')).toBe('en')
  })
})
