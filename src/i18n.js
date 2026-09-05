// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// Device-local UI language, in the same register as fx.js: a per-phone
// preference (babylog:lang), never a synced household setting — the night
// shift being in Spanish shouldn't flip the partner's phone.
//
// Keys are the English source strings themselves; a catalog maps them to the
// device language and anything missing falls back to English, so a stale
// catalog can never blank the UI. Dynamic bits ride {param} placeholders.
//
// IMPORTANT — the wire stays English. Entry details ('Left · 30m',
// 'breastmilk'), shift until-labels ('Until 6 AM'), and med names are stored
// and synced as canonical strings that dSplit()/untilAt() regex-parse; they
// translate at RENDER time only. Translating one into state would corrupt the
// shared log for every other device.

const KEY = 'babylog:lang'

// the top-15 most spoken languages (Nigerian Pidgin, #14 by speakers, has no
// established app-localization convention — the next two ranked fill in)
export const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'ar', label: 'العربية', rtl: true },
  { code: 'bn', label: 'বাংলা' },
  { code: 'pt', label: 'Português' },
  { code: 'ru', label: 'Русский' },
  { code: 'ur', label: 'اردو', rtl: true },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ja', label: '日本語' },
  { code: 'mr', label: 'मराठी' },
  { code: 'te', label: 'తెలుగు' },
]

let lang = 'en'
let dict = {}
let onChange = null

// vite bundles each catalog as its own chunk; only the active one downloads
const CATALOGS = import.meta.glob('./locales/*.js')

function saved() {
  try { return localStorage.getItem(KEY) } catch { return null }
}

// first launch: the browser language wins when we speak it (base tag match —
// pt-BR finds pt, zh-Hans-CN finds zh); otherwise English
export function detectLang() {
  const pick = saved()
  if (pick && LANGS.some(l => l.code === pick)) return pick
  const navs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'])
  for (const n of navs) {
    const base = String(n).toLowerCase().split('-')[0]
    if (LANGS.some(l => l.code === base)) return base
  }
  return 'en'
}

async function loadDict(code) {
  if (code === 'en') return {}
  const load = CATALOGS['./locales/' + code + '.js']
  if (!load) return {}
  try { return (await load()).default || {} } catch { return {} } // chunk fetch failed offline — English carries on
}

function applyDocLang() {
  const el = document.documentElement
  el.lang = lang
  el.dir = LANGS.find(l => l.code === lang)?.rtl ? 'rtl' : 'ltr'
}

export async function initI18n(notify) {
  onChange = notify || onChange
  lang = detectLang()
  dict = await loadDict(lang)
  applyDocLang()
}

export async function setLang(code) {
  if (!LANGS.some(l => l.code === code)) return
  try { localStorage.setItem(KEY, code) } catch { /* stays for this load only */ }
  lang = code
  dict = await loadDict(code)
  applyDocLang()
  if (onChange) onChange()
}

export function getLang() { return lang }
// for toLocaleDateString and friends — undefined keeps the browser's regional
// formats while the app itself is in English
export function locale() { return lang === 'en' ? undefined : lang }

export function t(str, params) {
  let out = dict[str] || str
  if (params) for (const k of Object.keys(params)) out = out.split('{' + k + '}').join(String(params[k]))
  return out
}

// English lowercases mid-sentence type names ("Save bottle"); most other
// languages don't downcase nouns (German capitalizes them outright)
export function lower(s) { return lang === 'en' ? String(s).toLowerCase() : s }
