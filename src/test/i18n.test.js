// The device-language layer: English-key fallback, {param} interpolation,
// per-device persistence (babylog:lang), and the RTL document flip for
// Arabic/Urdu. Catalog CONTENT is spot-checked only for shape elsewhere —
// these tests pin the mechanics every locale rides on.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { t, setLang, getLang, detectLang, initI18n, locale, lower, LANGS } from '../i18n.js'

beforeEach(() => localStorage.clear())
// leave the module back in English so other test files see the default
afterEach(async () => { await setLang('en'); localStorage.clear() })

describe('t()', () => {
  it('falls back to the key itself in English / for unknown keys', () => {
    expect(t('Settings')).toBe('Settings')
    expect(t('some string no catalog will ever have')).toBe('some string no catalog will ever have')
  })
  it('interpolates {params}, including repeats', () => {
    expect(t('{n} feeds — {n} today', { n: 3 })).toBe('3 feeds — 3 today')
    expect(t('Emailed {email} — their code is {code}', { email: 'a@b.c', code: 'XYZ' }))
      .toBe('Emailed a@b.c — their code is XYZ')
  })
})

describe('language selection', () => {
  it('lists the 15 supported languages with en first', () => {
    expect(LANGS).toHaveLength(15)
    expect(LANGS[0].code).toBe('en')
    expect(new Set(LANGS.map(l => l.code)).size).toBe(15)
  })
  it('detectLang prefers the saved device pick over navigator', () => {
    localStorage.setItem('babylog:lang', 'de')
    expect(detectLang()).toBe('de')
    localStorage.setItem('babylog:lang', 'xx') // unknown saved value → navigator/en
    expect(detectLang()).toBe('en') // jsdom navigator is en-US
  })
  it('setLang persists, loads the catalog, and translates', async () => {
    await setLang('es')
    expect(getLang()).toBe('es')
    expect(localStorage.getItem('babylog:lang')).toBe('es')
    expect(locale()).toBe('es')
    // a core key must actually be translated (not the English fallback)
    expect(t('Settings')).not.toBe('Settings')
  })
  it('English keeps browser-regional date formats (locale() undefined)', async () => {
    await setLang('en')
    expect(locale()).toBeUndefined()
  })
})

describe('document direction', () => {
  it('Arabic flips the document to RTL, English back to LTR', async () => {
    await setLang('ar')
    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('ar')
    await setLang('en')
    expect(document.documentElement.dir).toBe('ltr')
  })
})

describe('lower()', () => {
  it('lowercases only in English (German nouns keep their capitals)', async () => {
    expect(lower('Bottle')).toBe('bottle')
    await setLang('de')
    expect(lower('Flasche')).toBe('Flasche')
  })
})

describe('catalog shape', () => {
  // every locale must cover the full en.js key list, and translations must
  // carry the exact {param} placeholders of their key — a dropped placeholder
  // renders literally as "{name}" to the user
  const catalogs = import.meta.glob('../locales/*.js', { eager: true })
  const en = catalogs['../locales/en.js'].default
  const phOf = s => (s.match(/\{[a-z0-9]+\}/gi) || []).sort().join(',')

  it('ships a catalog for every supported language', () => {
    for (const l of LANGS) expect(catalogs['../locales/' + l.code + '.js'], l.code).toBeTruthy()
  })
  for (const [path, mod] of Object.entries(catalogs)) {
    if (path.endsWith('/en.js')) continue
    it(path.split('/').pop() + ' covers every key with placeholders intact', () => {
      const d = mod.default
      const missing = Object.keys(en).filter(k => !(k in d) || !d[k])
      expect(missing, 'missing keys').toEqual([])
      const broken = Object.keys(en).filter(k => phOf(k) !== phOf(d[k] || ''))
      expect(broken, 'placeholder mismatches').toEqual([])
    })
  }
})

describe('initI18n', () => {
  it('boots into the saved language', async () => {
    localStorage.setItem('babylog:lang', 'fr')
    await initI18n()
    expect(getLang()).toBe('fr')
    expect(document.documentElement.lang).toBe('fr')
  })
})
