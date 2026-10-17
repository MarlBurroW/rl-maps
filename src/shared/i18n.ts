// Traductions. Le texte français sert de clé : t('Installer') -> « Install » en anglais.
// Variables : t('{n} maps installées', { n: 3 }). Toute clé absente du dictionnaire reste en français
// (tests/i18n.test.ts vérifie qu'aucune n'est oubliée).

import { EN } from './i18n.en'

export type Lang = 'fr' | 'en'
export type LanguageSetting = 'auto' | Lang

let current: Lang = 'fr'

export const setLang = (lang: Lang) => {
  current = lang
}
export const getLang = () => current

/** Langue effective : réglage explicite, sinon celle du système (anglais si elle n'est pas le français). */
export const resolveLang = (setting: LanguageSetting | undefined, systemLocale: string): Lang =>
  setting === 'fr' || setting === 'en' ? setting : systemLocale.toLowerCase().startsWith('fr') ? 'fr' : 'en'

export function t(text: string, vars?: Record<string, string | number>): string {
  const base = current === 'en' ? (EN[text] ?? text) : text
  return vars ? base.replace(/\{(\w+)\}/g, (m: string, k: string) => (k in vars ? String(vars[k]) : m)) : base
}

/** Choix singulier / pluriel. */
export const plural = (n: number, one: string, many: string, vars?: Record<string, string | number>) =>
  t(n > 1 ? many : one, { n, ...vars })

/** Marque un texte à traduire plus tard avec t() (libellés stockés dans des constantes). */
export const tk = (text: string) => text
