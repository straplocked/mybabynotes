// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
import React from 'react'
import { S } from './s'
import Logo, { Wordmark } from './Logo'
import { api, getToken, setToken } from './api'
import { startEcho, stopEcho, isEchoConnected } from './echo'
import { pushSupported, pushSubscription, subscribePush, deviceTz } from './push'
import { getFx, setFx, initFx, isDark, askTiltPermission, reduceMotion } from './fx'
import { mapBabyBuddy, chunk } from './bbimport'
// imported, not referenced as /art/*.png, so the build content-hashes them into
// /assets/. Unhashed art URLs let the service worker pair a *new* stylesheet
// with a *stale* bitmap — and since these went from an opaque cream field to
// bare motifs, that pairing paints a light slab over dark mode. A hashed URL
// can't be stale, and the app no longer hardcodes an origin-root path.
import appBgArt from './art/app-bg.png'
import sheetBgArt from './art/sheet-bg.png'
// t() renders English keys in the device language (see src/i18n.js); labels
// in the constants below stay canonical English and translate at render time
import { t, lower, locale, getLang, setLang, LANGS } from './i18n'

// ── domain constants (from design/Baby Log.dc.html) ──────────────────────────
const TYPES = [
  { key: 'bottle', label: 'Bottle',  icon: 'local_drink',           color: 'oklch(0.60 0.075 250)', detail: 'amount' },
  { key: 'nurse',  label: 'Nursing', icon: 'child_care',            color: 'oklch(0.60 0.075 350)', detail: 'side' },
  { key: 'pump',   label: 'Pump',    icon: 'opacity',               color: 'oklch(0.60 0.075 300)', detail: 'amount' },
  { key: 'wet',    label: 'Wet',     icon: 'baby_changing_station', color: 'oklch(0.60 0.075 210)' },
  { key: 'dirty',  label: 'Dirty',   icon: 'baby_changing_station', color: 'oklch(0.60 0.075 60)' },
  { key: 'both',   label: 'Both',    icon: 'baby_changing_station', color: 'oklch(0.60 0.075 130)' },
  { key: 'sleep',  label: 'Sleep',   icon: 'bedtime',               color: 'oklch(0.60 0.075 25)', detail: 'dur' },
  { key: 'tummy',  label: 'Tummy time', icon: 'bedroom_baby',       color: 'oklch(0.60 0.075 95)', detail: 'dur' },
  { key: 'bath',   label: 'Bath',    icon: 'bathtub',               color: 'oklch(0.60 0.075 195)' },
  { key: 'meds',   label: 'Meds',    icon: 'medication',            color: 'oklch(0.60 0.075 150)' },
]
const T = k => TYPES.find(t => t.key === k) || TYPES[0]
const FEEDS = ['bottle', 'nurse']
const DIAPERS = ['wet', 'dirty', 'both']
// trackers a household can switch off — feeds are the app's spine and stay on
const TRACKS = [
  { key: 'pump',    label: 'Pump',    types: ['pump'] },
  { key: 'diapers', label: 'Diapers', types: DIAPERS },
  { key: 'sleep',   label: 'Sleep',   types: ['sleep'] },
  { key: 'tummy',   label: 'Tummy time', types: ['tummy'] },
  { key: 'bath',    label: 'Bath',    types: ['bath'] },
  { key: 'meds',    label: 'Meds',    types: ['meds'] },
]
// "since last …" cards for the Now screen. `track` gates a card on its tracker
// being on; feeds has none (always available). Order here is the display order.
const WIDGETS = [
  { key: 'feeds',   keys: FEEDS,     label: 'Fed',    icon: 'local_drink',           color: 'oklch(0.60 0.075 250)' },
  { key: 'pump',    keys: ['pump'],  label: 'Pumped', icon: 'opacity',               color: 'oklch(0.60 0.075 300)', track: 'pump' },
  { key: 'diapers', keys: DIAPERS,   label: 'Diaper', icon: 'baby_changing_station', color: 'oklch(0.60 0.075 210)', track: 'diapers' },
  { key: 'sleep',   keys: ['sleep'], label: 'Slept',  icon: 'bedtime',               color: 'oklch(0.60 0.075 25)',  track: 'sleep' },
  { key: 'tummy',   keys: ['tummy'], label: 'Tummy time', icon: 'bedroom_baby',      color: 'oklch(0.60 0.075 95)',  track: 'tummy' },
  { key: 'bath',    keys: ['bath'],  label: 'Bath',   icon: 'bathtub',               color: 'oklch(0.60 0.075 195)', track: 'bath' },
  { key: 'meds',    keys: ['meds'],  label: 'Meds',   icon: 'medication',            color: 'oklch(0.60 0.075 150)', track: 'meds' },
]
// the Now grid before anyone customized it — matches the original fixed four
const DEFAULT_WIDGETS = ['feeds', 'diapers', 'sleep', 'bath']
// age-typical ranges, distilled from docs/feeding-patterns.md — [max age in weeks, range]
const WAKE_NORMS = [
  [4, '30–90m'], [13, '60–90m'], [17, '75m–2h'], [22, '1.5–2.5h'], [30, '2–3h'],
  [43, '2.5–3.5h'], [61, '3–4h'], [104, '4–6h'], [999, '5–6h'],
]
const FEED_NORMS = [
  [4, 'every 1–3h'], [13, 'every 2–4h'], [26, 'every 2.5–4h'],
  [39, 'every 3–4h plus starting solids'], [52, 'every 4–5h plus meals'],
  [999, '3 meals plus snacks, milk alongside'],
]
const normFor = (norms, weeks) => (norms.find(([max]) => weeks < max) || norms[norms.length - 1])[1]
// ── AGPL §13: an app served over a network must offer its users the source ───
// Settings' About footer links here. Anyone deploying a MODIFIED build must
// point this at THEIR source, not ours — hence the build-time override
// (`VITE_SOURCE_URL=… npm run build`) rather than a hardcoded constant.
const SOURCE_URL = import.meta.env?.VITE_SOURCE_URL || 'https://github.com/straplocked/mybabynotes'
// feeds closer together than this are one cluster-feeding session, not a new rhythm beat
const CLUSTER_GAP = 45 * 60000
const sessionStarts = ts => { // ts ascending → first feed of each session
  const out = []
  for (let i = 0; i < ts.length; i++) if (i === 0 || ts[i] - ts[i - 1] > CLUSTER_GAP) out.push(ts[i])
  return out
}
// duration quick-select: a few presets, and dragging a chip up/down scrubs a
// custom value along this ladder — fine steps for short naps, coarser as hours stack
const DUR_LADDER = (() => {
  const a = []
  for (let v = 5; v < 60; v += 5) a.push(v)
  for (let v = 60; v < 180; v += 15) a.push(v)
  for (let v = 180; v <= 720; v += 30) a.push(v)
  return a
})()
// ounces run in halves — the same 0.5 steps the old chip row offered, just scrubbable
const OZ_LADDER = Array.from({ length: 24 }, (_, i) => (i + 1) / 2)
// ml runs in 10s and spans the same range as the oz ladder (~⅓–12 oz)
const ML_LADDER = Array.from({ length: 36 }, (_, i) => (i + 1) * 10)
// ── units: amounts are STORED AND SYNCED IN OZ, always ──────────────────────
// The household 'unit' setting only changes what people see and type; ml
// exists at the edges (chips + display) and converts right back to oz.
const ML_PER_OZ = 29.5735
// display: nearest 5 ml reads like the nursery convention (4 oz → 120, not 118.294)
const ozToMl = oz => Math.round(oz * ML_PER_OZ / 5) * 5
// storage: back to oz at 2 decimals — 120 ml → 4.06 oz → 120 ml round-trips
const mlToOz = ml => Math.round(ml / ML_PER_OZ * 100) / 100
// every scrubbable chip kind: a few tap presets, and the ladder a drag walks along
const SCRUB = {
  dur:  { presets: [30, 45, 90],      ladder: DUR_LADDER },
  mins: { presets: [10, 20, 30],      ladder: DUR_LADDER },
  oz:   { presets: [3, 4, 5],         ladder: OZ_LADDER },
  ml:   { presets: [90, 120, 150],    ladder: ML_LADDER }, // the oz presets' conventional twins
}
const ladderIdx = (ladder, v) => {
  let best = 0
  for (let i = 1; i < ladder.length; i++) if (Math.abs(ladder[i] - v) < Math.abs(ladder[best] - v)) best = i
  return best
}
const OLIVE = 'var(--accent)'
const DAY = 86400000
const ME_COLOR = '#7A93B5'
const PARTNER_COLOR = 'var(--accent)'
// >2 grown-ups: each member keeps a stable color from their position in the
// id-ordered members list (the server sends it sorted, so every device agrees).
// The first two slots are the classic me/partner pair; extras walk the type
// color hue ladder. JS style objects bypass S(), so vars/oklch only here.
const MEMBER_COLORS = [ME_COLOR, PARTNER_COLOR, 'oklch(0.60 0.075 300)', 'oklch(0.60 0.075 60)', 'oklch(0.60 0.075 195)', 'oklch(0.60 0.075 350)']
// old-server fallbacks only — /state's `limits` key is the live source of
// truth (maxMembers/maxChildren); these match the config defaults it mirrors
const MAX_MEMBERS = 6
const MAX_CHILDREN = 10
// caps read as words in prose while they stay small ("six grown-ups");
// anything past ten falls back to digits
const spellCount = n => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] || String(n)

// ── household theme (accent + background) ────────────────────────────────────
// Peach is the brand scheme (marketing comp Landing.dc.html) and carries explicit
// values: its deep/text roles are plum — a different hue — so they can't be
// derived from the accent like the others; `text`/`darkDeep`/`darkText` override
// applyTheme's color-mix derivations when present. Every other accent keeps
// olive's exact oklch lightness/chroma ladder (main ≈0.61/0.073, deep ≈0.43/0.054,
// hover ≈0.56/0.069) so contrast holds at any hue; backgrounds stay at cream's
// ≈0.97 lightness so ink text always reads.
const THEME_ACCENTS = {
  peach: { label: 'Peach', accent: '#E8957A', rgb: '232,149,122', deep: '#B5566A', hover: '#D9846A', text: '#A34D62', darkDeep: '#F4C2CC', darkText: '#E8A5B3' },
  olive: { label: 'Olive', accent: '#7C8C5A', rgb: '124,140,90', deep: '#4A5533', hover: '#6B7A4C' },
  clay: { label: 'Clay', accent: '#AB7663', rgb: '171,118,99', deep: '#6A4639', hover: '#966554' },
  rose: { label: 'Rose', accent: '#AB727E', rgb: '171,114,126', deep: '#6A434C', hover: '#96626D' },
  plum: { label: 'Plum', accent: '#9E759A', rgb: '158,117,154', deep: '#61455E', hover: '#8A6486' },
  sea: { label: 'Sea', accent: '#4A919D', rgb: '74,145,157', deep: '#275860', hover: '#3C7E89' },
  denim: { label: 'Denim', accent: '#6B85B1', rgb: '107,133,177', deep: '#3E506E', hover: '#5B749C' },
}
const THEME_BGS = {
  cream: { label: 'Cream', bg: '#FAF6EF', rgb: '250,246,239' },
  blush: { label: 'Blush', bg: '#FDF4F3', rgb: '253,244,243' },
  mist: { label: 'Mist', bg: '#F1F8FD', rgb: '241,248,253' },
  sage: { label: 'Sage', bg: '#F4F8F1', rgb: '244,248,241' },
  lilac: { label: 'Lilac', bg: '#F9F5FC', rgb: '249,245,252' },
}
// Dark counterparts keep each background's hue so the household's tint survives
// the flip; neutrals flip in styles.css (html.dark). Depth is the marketing
// site's (mybabynotes.app, `--bg:#161019`): oklch ≈0.185 lightness / ≈0.020
// chroma. The earlier ≈0.23/≈0.011 ladder read as grey rather than night —
// cream is now that site value verbatim, the rest match its L/C at their hue.
const THEME_BGS_DARK = {
  cream: { bg: '#161019', rgb: '22,16,25' },
  blush: { bg: '#1B0F11', rgb: '27,15,17' },
  mist: { bg: '#0B141B', rgb: '11,20,27' },
  sage: { bg: '#0F150B', rgb: '15,21,11' },
  lilac: { bg: '#15101A', rgb: '21,16,26' },
}
let appliedThemeSig = null
function applyTheme(theme) {
  const a = THEME_ACCENTS[theme?.accent] || THEME_ACCENTS.peach
  const bKey = THEME_BGS[theme?.bg] ? theme.bg : 'cream'
  const dark = isDark()
  const b = dark ? THEME_BGS_DARK[bKey] : THEME_BGS[bKey]
  const sig = a.accent + b.bg
  if (appliedThemeSig === sig) return
  appliedThemeSig = sig
  const el = document.documentElement
  el.classList.toggle('dark', dark)
  el.style.colorScheme = dark ? 'dark' : 'light'
  const r = el.style
  r.setProperty('--accent', a.accent)
  r.setProperty('--accent-rgb', a.rgb)
  // accent text roles re-derive against the flipped neutrals: "deep" must be
  // the readable end, so in dark it mixes toward cream instead of black
  r.setProperty('--accent-deep', dark ? (a.darkDeep || `color-mix(in oklab, ${a.accent} 58%, #F2EDE2)`) : a.deep)
  r.setProperty('--accent-hover', dark ? `color-mix(in oklab, ${a.accent} 84%, #14120F)` : a.hover)
  r.setProperty('--accent-text', dark ? (a.darkText || `color-mix(in oklab, ${a.accent} 68%, #F2EDE2)`) : (a.text || `color-mix(in oklab, ${a.accent} 74%, #26231D)`))
  r.setProperty('--bg', b.bg)
  r.setProperty('--bg-rgb', b.rgb)
  // there are light + dark media-split tags (index.html); the browser honors
  // whichever matches the OS, so write the household tint to all of them
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.content = b.bg })
}

// ── local-first persistence (per-device cache; server is the shared log) ─────
const STORE_KEY = 'babylog:v2'
const PERSIST = ['screen', 'authMode', 'entries', 'babyName', 'nameField', 'inviteField', 'age',
  'me', 'partner', 'invitePending', 'inviteCode', 'inviteMailed', 'onDutyUserId', 'serverShift', 'dismissedShiftId',
  'outbox', 'lastSync', 'plan', 'until', 'handbackNote', 'askNote', 'settings', 'settingsDirty', 'babyBirthdate',
  'notifyPrefs', 'notifyPrefsDirty', 'vapidKey', 'activeTimers', 'timerSides', 'timerSpot', 'advancedDefault',
  // multi-child household: the lists sync via /state; selectedChildId is a
  // DEVICE-LOCAL viewing preference (null = primary child) and never syncs
  'children', 'members', 'selectedChildId',
  // invites[] syncs like members; inviteCodeFor remembers which pending invite
  // the cached inviteCode belongs to (codes are shown once, only to the inviter).
  // inviteRole rides with inviteField so a reload mid-invite can't silently
  // downgrade a chosen caregiver seat back to parent
  'invites', 'inviteCodeFor', 'inviteRole',
  // server caps + removed-member name snapshots — cached like members so a
  // reload before the next pull still greys buttons and names old entries
  'limits', 'formerMembers']

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null } catch { return null }
}
const numify = d => (typeof d === 'string' && /^\d+(\.\d+)?$/.test(d)) ? Number(d) : d
// detail strings can carry extras: bottle "4 breastmilk", nurse "Left · 30m",
// pump "3 · 15m", tagged sleep "Nap · 45m" (untagged stays bare minutes)
const dSplit = d => {
  d = d == null ? '' : String(d)
  const lead = /^([\d.]+)\s*(m\b)?/.exec(d)
  const mm = /(\d+)\s*m\b/.exec(d)
  return {
    n: lead && lead[1] && !lead[2] ? Number(lead[1]) : null,
    mins: mm ? Number(mm[1]) : null,
    side: /left/i.test(d) ? 'Left' : /right/i.test(d) ? 'Right' : /both/i.test(d) ? 'Both' : null,
    milk: /breast/i.test(d) ? 'breastmilk' : /formula/i.test(d) ? 'formula' : null,
    when: /nap/i.test(d) ? 'Nap' : /night/i.test(d) ? 'Night' : null,
  }
}
// sleep/tummy minutes, whichever way the wire spells them: bare leading number
// (the timer's legacy format) or a "45m" token ("Nap · 45m") — null when absent
const sleepMins = d => { const { n, mins } = dSplit(d); return mins ?? n }
// sleep/tummy are the only types the wire stamps at the END of the session (t =
// wake-up, duration in detail); every other type stamps its start. The log
// reads top-down — a nap prints, sorts and buckets at the moment it STARTED, so
// anything rendering an entry's own time goes through here. Measures of "how
// long since it ended" (the since-cards, the wake window) keep reading e.t.
const SPANS = ['sleep', 'tummy']
const startOf = e => SPANS.includes(e.type) ? e.t - (sleepMins(e.detail) || 0) * 60000 : e.t
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'e' + Date.now() + Math.random().toString(36).slice(2, 9))
const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
const csvEsc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v }

const Sym = ({ style, children }) => (
  <span style={{ fontFamily: "'Material Symbols Rounded'", lineHeight: 1, ...style }}>{children}</span>
)

// queued-but-unsynced marker: a dimmed dot on a row's sub line, same register
// as the header's "· offline" — it clears the moment the outbox flushes
const PendingDot = () => (
  <span style={S('display:inline-block;width:5px;height:5px;border-radius:999px;background:rgba(38,35,29,0.30);margin-left:6px;vertical-align:1px')} />
)

export default class App extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      screen: 'splash', authMode: 'signup', tick: 0,
      authName: '', authEmail: '', authPassword: '', authInvite: '', authError: null, authBusy: false,
      inviteCode: null, inviteMailed: false,
      forgotOpen: false, forgotEmail: '', forgotBusy: false, forgotResult: null, // null | 'sent' | 'unconfigured' | 'error'
      resetToken: null, resetEmail: '', resetPw: '', resetBusy: false, resetError: null, // ?reset=<token>&email= flow
      entries: [], // includes tombstones ({deleted:true}); views filter them
      sheet: false, sel: null, offset: 0, pickedT: null, dayPicked: false, detail: null, detail2: null, editId: null, historyDay: null, scrubDrag: null,
      // the sheet's "Advanced" drawer (the day control): `advanced` is per
      // opening and never persisted; `advancedDefault` is the DEVICE-LOCAL pref
      // for how each opening starts — off, because the common log is "now"
      advanced: false, advancedDefault: false,
      // concurrent timers (twins!): [{id, type, started_at, user_id, baby_id}]
      // in start order; timerSides remembers each nurse timer's pre-picked side
      // by timer id. timerSpot is a DEVICE-LOCAL pref (like selectedChildId)
      // for where running timers appear: 'top' (cards), 'today' (rows woven
      // into the Today list), or 'both' — either surface stops in one tap
      activeTimers: [], timerSides: {}, timerSpot: 'both', manualDur: false,
      sheetDragY: 0, sheetDragging: false, sheetTall: false, sheetIn: false, sheetLeaving: false,
      toast: null, toastLeaving: false, undoAction: null,
      babyName: '', nameField: '', inviteField: '', age: '2–8 wks', babyBirthdate: null, dobField: '',
      me: null, partner: null, invitePending: null,
      children: [], members: [], selectedChildId: null, sheetChildId: null,
      invites: [], inviteRole: 'parent', inviteCodeFor: null,
      limits: null, formerMembers: [], // /state extras; constants/no-names until a new server answers
      // settings management UI — ephemeral, like the acct* fields
      childEdits: {}, childAddOpen: false, childAddName: '', childAddDob: '', childBusy: false, removeConfirmId: null,
      onDutyUserId: null, serverShift: null, dismissedShiftId: null,
      outbox: [], lastSync: 0, offline: false,
      settings: { tracking: {}, dismissed: [] }, settingsDirty: false,
      exportRange: 'all', // ephemeral — resets to Everything each load on purpose
      importBusy: false, // Baby Buddy CSV import in flight — ephemeral
      // account editing (settings) — ephemeral, seeded from me/baby when the screen opens
      acctName: '', acctBabyName: '', acctOpen: null, // null | 'email' | 'password'
      acctEmail: '', acctEmailPw: '', acctPwCur: '', acctPwNew: '', acctBusy: false, acctError: null,
      // API access (settings) — ephemeral; tokens are fetched on expand, never in /state
      apiTokens: null, apiScopes: null, tokensOpen: false, tokenAddOpen: false,
      tokenName: '', tokenScopes: [], tokenExpiry: 90, tokenBusy: false, tokenError: null,
      newToken: null, revokeTokenArmId: null,
      // Home Assistant / MQTT bridge (settings, parents only) — ephemeral, fetched on expand
      mqttOpen: false, mqttCfg: null, mqttForm: null, mqttBusy: false, mqttTestResult: null, mqttError: null,
      notifyPrefs: null, notifyPrefsDirty: false, vapidKey: null, pushOn: false, pushBusy: false,
      shiftOpen: false, shiftIn: false, shiftLeaving: false, shiftDragY: 0, shiftDragging: false, shiftMode: null, planDraft: null, planOff: [], until: 'Until she wakes', plan: [], handbackNote: '',
      // the ask's note is its own field: a half-typed handback note must not
      // silently become the message you send asking for cover
      askNote: '', askTarget: null, askSeenId: null, planAddOpen: null,
      fx: getFx(), // device-local (babylog:fx), not in PERSIST
    }
    const saved = loadSaved()
    if (saved) for (const k of PERSIST) if (k in saved) this.state[k] = saved[k]
    // a device upgrading from the single-timer era persisted {activeTimer, timerSide}
    if (saved?.activeTimer && !saved.activeTimers) {
      this.state.activeTimers = [saved.activeTimer]
      if (saved.timerSide) this.state.timerSides = { [saved.activeTimer.id]: saved.timerSide }
    }
    // …and the short-lived timersInFeed boolean became timerSpot (off = top-only)
    if (saved && !('timerSpot' in saved) && saved.timersInFeed === false) this.state.timerSpot = 'top'
    this.state.settings = { tracking: {}, dismissed: [], ...(this.state.settings || {}) }
    // in-flight timer start/stop request counter — while >0 the server's timer
    // list is stale and must not clobber our optimistic rows
    this._timerBusy = 0
    // one drag gesture, two sheets (see sheetGestures) — the entry sheet has a
    // tall detent, the shift sheet is one height, so it passes tall: null
    this.sheetDrag = this.sheetGestures({ y: 'sheetDragY', dragging: 'sheetDragging', tall: 'sheetTall', close: () => this.closeSheet() })
    this.shiftDrag = this.sheetGestures({ y: 'shiftDragY', dragging: 'shiftDragging', tall: null, close: () => this.closeShift() })
    // no token → cached signed-in screens are stale
    if (!getToken() && !['splash', 'auth'].includes(this.state.screen)) this.state.screen = 'splash'
    // arriving from a password-reset email: ?reset=<token>&email=<addr> — the
    // token lives only in memory; a reload after replaceState falls through
    try {
      const q = new URLSearchParams(window.location.search)
      if (q.get('reset') && q.get('email')) {
        this.state.resetToken = q.get('reset')
        this.state.resetEmail = q.get('email')
        this.state.screen = 'reset'
      } else if (this.state.screen === 'reset') this.state.screen = 'splash'
    } catch { if (this.state.screen === 'reset') this.state.screen = 'splash' }
  }

  componentDidMount() {
    this._iv = setInterval(() => {
      this.setState(s => ({ tick: s.tick + 1 }))
      // realtime pokes carry the load; poll only as fallback / slow heartbeat
      if (!isEchoConnected() || this.state.tick % 3 === 0) this.sync()
    }, 20000)
    // a running timer needs a live second hand; idle when none is going
    this._sec = setInterval(() => { if (this.state.activeTimers.length) this.setState(s => ({ tick: s.tick + 1 })) }, 1000)
    this._wake = () => this.sync()
    window.addEventListener('focus', this._wake)
    window.addEventListener('online', this._wake)
    document.addEventListener('visibilitychange', this._wake)
    if (getToken()) this.sync()
    this.refreshPush()
    initFx(() => applyTheme(this.state.settings.theme)) // OS scheme / light sensor changes re-resolve dark
    applyTheme(this.state.settings.theme)
    // Android back gesture closes overlays in stacking order: sheet first,
    // then the settings screen back to Now (the only place it opens from)
    // — never straight out of the app.
    // A stale entry can survive a reload mid-overlay — drop it so back exits.
    this._pop = () => {
      if (this.state.sheet) return this.dismissSheet()
      if (this.state.shiftOpen) return this.dismissShift()
      if (this.state.screen === 'history' && this.state.historyDay) return this.setState({ historyDay: null })
      if (this.state.screen === 'settings') this.setState({ screen: 'home' })
    }
    window.addEventListener('popstate', this._pop)
    if (window.history.state?.blSheet || window.history.state?.blShift || window.history.state?.blSettings || window.history.state?.blDay) {
      try { window.history.replaceState(null, '') } catch { /* fine */ }
    }
    // the reset token was captured into state — scrub it out of the URL/history
    if (window.location.search) {
      try { window.history.replaceState(null, '', window.location.pathname) } catch { /* fine */ }
    }
  }
  componentWillUnmount() {
    clearInterval(this._iv); clearInterval(this._sec); if (this._to) clearTimeout(this._to); if (this._flushTo) clearTimeout(this._flushTo)
    window.removeEventListener('focus', this._wake)
    window.removeEventListener('online', this._wake)
    document.removeEventListener('visibilitychange', this._wake)
    window.removeEventListener('popstate', this._pop)
    if (this._sheetTo) clearTimeout(this._sheetTo)
    if (this._shiftTo) clearTimeout(this._shiftTo)
    if (this._toGone) clearTimeout(this._toGone)
    stopEcho()
  }

  ensureEcho() {
    const hh = this.state.me?.householdId
    const token = getToken()
    if (!hh || !token) return
    const sig = token + ':' + hh
    if (this._echoSig === sig) return
    this._echoSig = sig
    startEcho(token, hh, { onPoke: () => this.sync(), onConnect: () => this.sync() })
  }
  componentDidUpdate() {
    const out = {}
    for (const k of PERSIST) out[k] = this.state[k]
    try { localStorage.setItem(STORE_KEY, JSON.stringify(out)) } catch { /* storage full/blocked — stay in-memory */ }
    applyTheme(this.state.settings.theme)
  }

  // ── sync ───────────────────────────────────────────────────────────────────
  flushSoon() {
    if (this._flushTo) clearTimeout(this._flushTo)
    this._flushTo = setTimeout(() => this.sync(), 250)
  }

  sync = async () => {
    if (!getToken() || this._syncing) return
    this._syncing = true
    try {
      if (this.state.outbox.length) {
        const ids = new Set(this.state.outbox)
        const pushed = new Map(this.state.entries.filter(e => ids.has(e.id)).map(e => [e.id, e]))
        const payload = [...pushed.values()]
          // baby_id rides along only when known — absent means "primary child"
          // on create and "keep what you have" on update, server-side. user_id
          // is the same shape: it names whose activity this was (a timer someone
          // else stopped stays credited to whoever ran it), and the server
          // honors it only for members of our household, only on create.
          .map(e => ({ id: e.id, type: e.type, t: e.t, detail: e.detail == null ? null : String(e.detail), deleted: !!e.deleted, ...(e.babyId != null ? { baby_id: e.babyId } : {}), ...(e.by != null ? { user_id: e.by } : {}) }))
        // the server caps 500 entries per batch — a Baby Buddy import (or any
        // bulk enqueue) flushes in slices; a failed slice throws, leaves the
        // outbox intact, and the idempotent upsert re-pushes it next sync
        for (const slice of chunk(payload, 500)) await api.pushEntries(slice)
        // an undo/edit while the push was in flight makes a new entry object —
        // keep that id queued so the newer write still pushes (and wins) next flush
        this.setState(s => ({ outbox: s.outbox.filter(id => !ids.has(id) || s.entries.find(e => e.id === id) !== pushed.get(id)) }))
      }
      if (this.state.settingsDirty) {
        const pushed = this.state.settings
        // widgets is null until the household customizes it — don't send the null
        const { widgets, ...rest } = pushed
        await api.saveSettings(widgets == null ? rest : pushed)
        // a toggle mid-flight makes a new settings object — only clear if nothing changed
        if (this.state.settings === pushed) this.setState({ settingsDirty: false })
      }
      if (this.state.notifyPrefsDirty && this.state.notifyPrefs) {
        const pushed = this.state.notifyPrefs
        await api.saveNotifyPrefs(pushed)
        if (this.state.notifyPrefs === pushed) this.setState({ notifyPrefsDirty: false })
      }
      const st = await api.state(this.state.lastSync)
      this.applyState(st)
      if (this.state.offline) this.setState({ offline: false })
    } catch (e) {
      if (e.status === 401) this.doLogout(false)
      else this.setState({ offline: true }) // no signal — local writes are queued
    } finally {
      this._syncing = false
    }
  }

  applyState(st) {
    this.setState(s => {
      const outbox = new Set(s.outbox)
      const map = new Map(s.entries.map(e => [e.id, e]))
      for (const e of (st.entries || [])) {
        if (outbox.has(e.id)) continue // our unpushed write wins for now
        // null babyId reads as the primary child everywhere a view filters
        map.set(e.id, { id: e.id, type: e.type, t: e.t, detail: numify(e.detail), deleted: !!e.deleted, by: e.user_id, babyId: e.baby_id ?? null })
      }
      // partner stays derived — the first other member — so the existing
      // two-person shift code keeps working in a many-member household
      const others = (st.members || []).filter(m => st.user && m.id !== st.user.id)
      const next = {
        entries: [...map.values()].sort((a, b) => b.t - a.t),
        me: st.user, invitePending: st.invitePending,
        partner: others.length ? { id: others[0].id, name: others[0].name } : (st.members ? null : st.partner ?? null),
        members: st.members || [],
        children: st.children || [],
        invites: st.invites || [],
        onDutyUserId: st.onDutyUserId, serverShift: st.shift,
        lastSync: st.serverTime,
        // server caps + removed-member snapshots; an old server sends neither,
        // so the cached values (or the constant fallbacks) keep applying
        ...(st.limits ? { limits: { maxMembers: Number(st.limits.maxMembers) || MAX_MEMBERS, maxChildren: Number(st.limits.maxChildren) || MAX_CHILDREN } } : {}),
        ...(st.formerMembers ? { formerMembers: st.formerMembers } : {}),
      }
      // a selected child that was removed server-side falls back to primary
      if (s.selectedChildId != null && !next.children.some(c => c.id === s.selectedChildId)) next.selectedChildId = null
      // server settings win unless a local toggle is still waiting to push
      if (!s.settingsDirty && st.settings && !Array.isArray(st.settings)) {
        next.settings = { tracking: st.settings.tracking || {}, dismissed: st.settings.dismissed || [], widgets: st.settings.widgets || null, ...(st.settings.theme ? { theme: st.settings.theme } : {}), ...(st.settings.unit ? { unit: st.settings.unit } : {}), ...(st.settings.medName ? { medName: st.settings.medName } : {}) }
      }
      if (!s.notifyPrefsDirty && st.user?.notifyPrefs) next.notifyPrefs = st.user.notifyPrefs
      if (st.vapidPublicKey) next.vapidKey = st.vapidPublicKey
      // server owns the running timers, except while our own start/stop is in
      // flight (a request counter); a pre-multi-timer server sends only the
      // singular key — wrap it so this client still renders its one row
      if (!this._timerBusy) next.activeTimers = st.timers || (st.timer ? [st.timer] : [])
      if (st.baby) {
        next.babyName = st.baby.name
        if (st.baby.age) next.age = st.baby.age
        if (st.baby.birthdate !== undefined) next.babyBirthdate = st.baby.birthdate
      }
      // An incoming ask proposes both a plan and a window. Adopt them into the
      // local draft once per ask, then leave them alone: from there they're
      // *yours* to edit before accepting, and a re-poll must not stomp a time
      // you just changed. Keyed on requested_at as well as id, so the asker
      // re-sending a revised ask (same row, new stamp) re-seeds.
      const askKey = st.shift && st.shift.state === 'requested' ? st.shift.id + ':' + (st.shift.requested_at || 0) : null
      if (askKey && st.user && st.shift.requester_id !== st.user.id && askKey !== s.askSeenId) {
        next.askSeenId = askKey
        next.planOff = []
        if (st.shift.until) next.until = st.shift.until
        if (Array.isArray(st.shift.plan) && st.shift.plan.length) next.planDraft = st.shift.plan
      }
      // my active shift plan lives on the server copy; someone else's active
      // shift means duty has moved on, so a plan left over from mine has to go
      // (it would otherwise render my old checklist next to their live one)
      if (st.shift && st.shift.state === 'active' && st.user) next.plan = st.shift.user_id === st.user.id ? (st.shift.plan || []) : []
      return next
    }, () => {
      this.ensureEcho()
      // partner just handed back to me → surface the shift report once
      const { serverShift: sh, me, shiftOpen, dismissedShiftId, screen } = this.state
      if (sh && sh.state === 'completed' && me && sh.user_id !== me.id && sh.id !== dismissedShiftId
        && !shiftOpen && this._autoOpened !== sh.id && screen === 'home') {
        this._autoOpened = sh.id
        this.mountShift()
      }
    })
  }

  // ── auth / onboarding ──────────────────────────────────────────────────────
  authSubmit = async () => {
    const s = this.state
    if (s.authBusy) return
    this.setState({ authBusy: true, authError: null })
    try {
      if (s.authMode === 'signup') {
        const r = await api.register({ name: s.authName.trim() || 'Parent', email: s.authEmail.trim(), password: s.authPassword, invite: s.authInvite.trim() || undefined })
        setToken(r.token)
      } else {
        const r = await api.login({ email: s.authEmail.trim(), password: s.authPassword })
        setToken(r.token)
      }
      const st = await api.state(0)
      this.setState({ entries: [], outbox: [], lastSync: 0, dismissedShiftId: null, authBusy: false, authPassword: '' })
      this.applyState(st)
      this.setState({ screen: st.baby ? 'home' : 'onboard', nameField: st.baby ? st.baby.name : '' })
    } catch (e) {
      const first = e.errors ? Object.values(e.errors)[0]?.[0] : null
      this.setState({ authBusy: false, authError: first || e.message || t('Something went wrong — try again.') })
    }
  }

  // ── forgot / reset password ────────────────────────────────────────────────
  sendForgot = async () => {
    const email = (this.state.forgotEmail || '').trim()
    if (!email || this.state.forgotBusy) return
    this.setState({ forgotBusy: true, forgotResult: null })
    try {
      const r = await api.forgotPassword(email)
      this.setState({ forgotBusy: false, forgotResult: r.sent ? 'sent' : 'unconfigured' })
    } catch {
      this.setState({ forgotBusy: false, forgotResult: 'error' })
    }
  }

  submitReset = async () => {
    const s = this.state
    if (s.resetBusy) return
    if ((s.resetPw || '').length < 8) return this.setState({ resetError: t('Pick a password with at least 8 characters.') })
    this.setState({ resetBusy: true, resetError: null })
    try {
      await api.resetPassword({ token: s.resetToken, email: s.resetEmail, password: s.resetPw })
      this.setState({
        screen: 'auth', authMode: 'login', authEmail: s.resetEmail, authError: null,
        resetToken: null, resetPw: '', resetBusy: false,
        toast: t('Password updated — log in with the new one'), undoAction: null,
      })
      this.bumpToast()
    } catch (e) {
      const first = e.errors ? Object.values(e.errors)[0]?.[0] : null
      this.setState({ resetBusy: false, resetError: first || e.message || t('Something went wrong — try again.') })
    }
  }

  finishOnboard = async () => {
    const name = (this.state.nameField || '').trim() || t('Baby')
    const age = this.state.age
    const birthdate = this.state.dobField || undefined
    this.setState({ screen: 'home', babyName: name, babyBirthdate: birthdate || null })
    try {
      await api.setBaby({ name, age, birthdate })
      if (this.state.inviteField.trim()) await this.sendInvite()
    } catch { this.setState({ offline: true }) }
  }

  // the form invites whoever's typed; a pending row's Resend re-invites itself
  sendInvite = () => this.sendInviteTo(this.state.inviteField.trim(), this.state.inviteRole)

  // shared invite/resend flow — the server upserts the row and mints a fresh
  // code (codes are stored hashed, so the old one can't be re-shown; the new
  // one invalidates it, same as re-typing the email always did)
  sendInviteTo = async (email, role) => {
    if (!email) return
    try {
      const r = await api.invite(email, role)
      this.setState(s => ({
        invitePending: email, inviteCode: r.code, inviteCodeFor: email.toLowerCase(), inviteMailed: !!r.mailed,
        // optimistic row until the next pull brings the server's list
        invites: s.invites.some(i => i.email === email.toLowerCase())
          ? s.invites.map(i => i.email === email.toLowerCase() ? { ...i, role } : i)
          : [...s.invites, { email: email.toLowerCase(), role }],
        // a resend must not eat whatever's half-typed in the invite field
        inviteField: s.inviteField.trim() === email ? '' : s.inviteField,
        toast: t(r.mailed ? 'Emailed {email} — their code is {code}' : 'Invited {email} — their code is {code}', { email, code: r.code }),
        undoAction: null,
      }))
      this.bumpToast()
    } catch (e) {
      const first = e.errors ? Object.values(e.errors)[0]?.[0] : null
      this.setState({ toast: e.status ? (first || e.message || t('Invite failed — check the email')) : t('No signal — try again later'), undoAction: null })
      this.bumpToast()
    }
  }

  // take back a pending invite — its code stops working right away
  revokeInvite = email => {
    this.setState(s => ({
      invites: s.invites.filter(i => i.email !== email),
      invitePending: s.invitePending === email ? null : s.invitePending,
      inviteCode: s.inviteCodeFor === email ? null : s.inviteCode,
      inviteCodeFor: s.inviteCodeFor === email ? null : s.inviteCodeFor,
      toast: t('Invite revoked — that code no longer works'), undoAction: null,
    }))
    this.bumpToast()
    api.revokeInvite(email).catch(() => this.setState({ offline: true }))
  }

  copyInviteCode = code => {
    try { navigator.clipboard.writeText(code).catch(() => { /* stays on screen to copy by hand */ }) } catch { /* no clipboard API */ }
    this.setState({ toast: t('Code copied — send it to them'), undoAction: null })
    this.bumpToast()
  }

  // remove a member (parents only; the server also refuses self-removal)
  removeMember = id => {
    const gone = this.memberById(id)
    this.setState(s => {
      const members = s.members.filter(m => m.id !== id)
      const others = members.filter(m => s.me && m.id !== s.me.id)
      return {
        removeConfirmId: null,
        members,
        partner: s.partner && s.partner.id === id ? (others.length ? { id: others[0].id, name: others[0].name } : null) : s.partner,
        toast: t('{name} can no longer open this log', { name: gone?.name || t('They') }), undoAction: null,
      }
    })
    this.bumpToast()
    api.removeMember(id).then(() => this.sync()).catch(e => {
      if (e.status) {
        this.setState({ toast: e.message || t('That didn’t go through — try again'), undoAction: null })
        this.bumpToast()
        this.sync() // fall back to server truth
      } else this.setState({ offline: true })
    })
  }

  doLogout = async (callApi = true) => {
    if (callApi) {
      // stop the server pushing at this device; the browser permission stays for next login
      try { const sub = await pushSubscription(); if (sub) await api.pushUnsubscribe(sub.endpoint) } catch { /* best-effort */ }
      try { await api.logout() } catch { /* token dies anyway */ }
    }
    setToken(null)
    stopEcho()
    this._echoSig = null
    try { localStorage.removeItem(STORE_KEY) } catch { /* ignore */ }
    this._autoOpened = null
    this.setState({
      screen: 'splash', authMode: 'signup', authName: '', authEmail: '', authPassword: '', authError: null,
      forgotOpen: false, forgotEmail: '', forgotResult: null,
      entries: [], outbox: [], lastSync: 0, me: null, partner: null, invitePending: null, inviteCode: null, inviteMailed: false,
      children: [], members: [], selectedChildId: null, sheetChildId: null,
      invites: [], inviteRole: 'parent', inviteCodeFor: null,
      limits: null, formerMembers: [],
      childEdits: {}, childAddOpen: false, childAddName: '', childAddDob: '', childBusy: false, removeConfirmId: null,
      onDutyUserId: null, serverShift: null, dismissedShiftId: null,
      babyName: '', nameField: '', inviteField: '', sheet: false, sheetIn: false, sheetLeaving: false,
      shiftOpen: false, shiftIn: false, shiftLeaving: false, toast: null, toastLeaving: false,
      plan: [], planDraft: null, planOff: [], handbackNote: '', shiftMode: null, askNote: '', askTarget: null,
      settings: { tracking: {}, dismissed: [] }, settingsDirty: false,
      notifyPrefs: null, notifyPrefsDirty: false, pushOn: false,
      activeTimers: [], timerSides: {}, manualDur: false,
      acctName: '', acctBabyName: '', acctOpen: null, acctError: null, acctBusy: false,
      acctEmail: '', acctEmailPw: '', acctPwCur: '', acctPwNew: '',
      apiTokens: null, apiScopes: null, tokensOpen: false, tokenAddOpen: false,
      tokenName: '', tokenScopes: [], tokenExpiry: 90, tokenBusy: false, tokenError: null,
      newToken: null, revokeTokenArmId: null,
      // Home Assistant / MQTT bridge (settings, parents only) — ephemeral, fetched on expand
      mqttOpen: false, mqttCfg: null, mqttForm: null, mqttBusy: false, mqttTestResult: null, mqttError: null,
    })
  }

  // ── notifications (per-user prefs; the push subscription is per-device) ────
  nPrefs() {
    return {
      handoff: true, partner: false, feed: false, feedEvery: null, feedEveryByChild: {}, onDutyOnly: true,
      wake: false, meds: false, medsTime: '09:00',
      quiet: false, quietStart: '22:00', quietEnd: '07:00', tz: null,
      ...(this.state.notifyPrefs || {}),
    }
  }
  setNotify = patch => this.setState({
    // always ride the device's timezone along so quiet hours + meds time are local
    notifyPrefs: { ...this.nPrefs(), ...patch, tz: deviceTz() || this.nPrefs().tz },
    notifyPrefsDirty: true,
  }, () => this.flushSoon())
  // a subscription surviving in the browser re-attaches to whoever is logged in now
  refreshPush = async () => {
    try {
      const sub = await pushSubscription()
      if (sub && getToken()) {
        // lang rides like tz — push copy renders per device on the server
        await api.pushSubscribe({ endpoint: sub.endpoint, keys: sub.toJSON().keys, tz: deviceTz(), lang: getLang() })
        this.setState({ pushOn: true })
      } else this.setState({ pushOn: false })
    } catch { /* offline — the toggle still reflects the browser's side */ }
  }
  togglePush = async () => {
    if (this.state.pushBusy) return
    this.setState({ pushBusy: true })
    try {
      if (this.state.pushOn) {
        const sub = await pushSubscription()
        if (sub) {
          try { await api.pushUnsubscribe(sub.endpoint) } catch { /* row prunes itself on next push */ }
          await sub.unsubscribe()
        }
        this.setState({ pushOn: false, toast: t('Notifications off for this phone'), undoAction: null })
      } else {
        const sub = await subscribePush(this.state.vapidKey)
        await api.pushSubscribe({ endpoint: sub.endpoint, keys: sub.toJSON().keys, tz: deviceTz(), lang: getLang() })
        this.setState({ pushOn: true, toast: t('This phone will get pings'), undoAction: null })
        this.setNotify({}) // stamp the device tz into prefs right away
      }
    } catch (e) {
      this.setState({
        toast: e && e.message === 'denied'
          ? t('Notifications are blocked — allow them in your browser settings')
          : t('Couldn’t turn notifications on — try again'),
        undoAction: null,
      })
    }
    this.setState({ pushBusy: false })
    this.bumpToast()
  }

  // ── children (multi-child households) ──────────────────────────────────────
  // primary = the household's oldest child (id order, same rule as the server's
  // compat `baby` key); entries with a null babyId belong to it
  primaryChildId() { return this.state.children[0]?.id ?? null }
  // the child the device is looking at: the picked one when it still exists,
  // else primary; null only before the first sync ever delivers children
  selChild() {
    const kids = this.state.children
    if (!kids || !kids.length) return null
    return (this.state.selectedChildId != null && kids.find(c => c.id === this.state.selectedChildId)) || kids[0]
  }
  selChildId() { const c = this.selChild(); return c ? c.id : null }

  // ── members (multi-member households) ──────────────────────────────────────
  // caregivers log, run timers, and cover shifts; only parents shape the
  // household — the server 403s them, this just keeps the controls honest
  isParent() { return (this.state.me?.role || 'parent') === 'parent' }
  // seat/child caps: the server's /state limits when it sends them, the
  // mirrored constants when it's an old server that doesn't
  maxMembers() { return this.state.limits?.maxMembers || MAX_MEMBERS }
  maxChildren() { return this.state.limits?.maxChildren || MAX_CHILDREN }
  // members includes me; me/partner are the pre-sync fallbacks for old caches;
  // formerMembers last, so removed people still put a name to their entries
  memberById(id) {
    if (id == null) return null
    const { me, partner, members, formerMembers } = this.state
    return members.find(m => m.id === id)
      || (me && me.id === id ? me : null)
      || (partner && partner.id === id ? partner : null)
      || (formerMembers || []).find(m => m.id === id)
      || null
  }
  memberName(id, fallback) { const m = this.memberById(id); return (m && m.name) || fallback }
  memberColor(id) {
    const i = this.state.members.findIndex(m => m.id === id)
    if (i >= 0) return MEMBER_COLORS[i % MEMBER_COLORS.length]
    // former members: a deterministic palette pick by id (stable on every
    // device, no list position to shift), dimmed toward the surface so a
    // gone member's chip reads quieter than a live one
    if ((this.state.formerMembers || []).some(m => m.id === id))
      return `color-mix(in srgb, ${MEMBER_COLORS[id % MEMBER_COLORS.length]} 65%, var(--surface))`
    return PARTNER_COLOR
  }

  // ── children management (settings; parents only — server enforces too) ─────
  // optimistic list update, keeping the primary-child compat mirrors in step
  childPatch(id, patch) {
    this.setState(s => {
      const children = s.children.map(c => c.id === id ? { ...c, ...patch } : c)
      const primary = children[0] && children[0].id === id
      return {
        children,
        ...(primary && patch.name != null ? { babyName: patch.name } : {}),
        ...(primary && patch.birthdate !== undefined ? { babyBirthdate: patch.birthdate } : {}),
      }
    })
  }
  setChildEdit = (id, val) => this.setState(s => ({ childEdits: { ...s.childEdits, [id]: val } }))
  saveChildName = id => {
    const c = this.state.children.find(x => x.id === id)
    if (!c) return
    const name = (this.state.childEdits[id] ?? '').trim()
    if (!name || name === c.name) return
    this.childPatch(id, { name })
    api.setChild({ id, name }).catch(() => this.setState({ offline: true }))
  }
  setChildDob = id => e => {
    const bd = e.target.value
    const c = this.state.children.find(x => x.id === id)
    if (!bd || !c) return
    this.childPatch(id, { birthdate: bd })
    // /children always wants the name — send the current one alongside
    api.setChild({ id, name: c.name || 'Baby', birthdate: bd }).catch(() => this.setState({ offline: true }))
  }
  toggleChildArchived = id => {
    const c = this.state.children.find(x => x.id === id)
    if (!c) return
    const archived = !c.archived
    this.childPatch(id, { archived })
    // archiving the child a device was viewing snaps that view back to primary
    this.setState(s => (archived && s.selectedChildId === id ? { selectedChildId: null } : null))
    api.setChild({ id, name: c.name || 'Baby', archived }).catch(() => this.setState({ offline: true }))
  }
  addChild = async () => {
    const name = this.state.childAddName.trim()
    if (!name || this.state.childBusy) return
    this.setState({ childBusy: true })
    try {
      const r = await api.setChild({ name, ...(this.state.childAddDob ? { birthdate: this.state.childAddDob } : {}) })
      this.setState(s => ({
        childBusy: false, childAddOpen: false, childAddName: '', childAddDob: '',
        children: s.children.some(c => c.id === r.child.id) ? s.children : [...s.children, r.child],
        toast: t('{name} added — the pills on Now switch between them', { name: r.child.name || t('Child') }), undoAction: null,
      }))
    } catch (e) {
      const first = e.errors ? Object.values(e.errors)[0]?.[0] : null
      this.setState({
        childBusy: false,
        toast: e.status ? (first || e.message || t('That didn’t go through — try again')) : t('No signal — try again in a moment.'),
        undoAction: null,
      })
    }
    this.bumpToast()
  }

  // ── entry helpers (views always work on live = non-deleted entries) ────────
  // every view and aggregate reads the selected child's log: a null babyId
  // counts as the primary child, and with no children known nothing filters
  live() {
    const selId = this.selChildId()
    if (selId == null) return this.state.entries.filter(e => !e.deleted)
    const primId = this.primaryChildId()
    return this.state.entries.filter(e => !e.deleted && (e.babyId ?? primId) === selId)
  }

  clock(t) {
    const d = new Date(t)
    let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'
    h = h % 12 || 12
    return h + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + ap
  }
  elapsed(t2) {
    const mins = Math.max(0, Math.round((Date.now() - t2) / 60000))
    if (mins < 60) return t('{n}m', { n: mins })
    const h = Math.floor(mins / 60), r = mins % 60
    if (h < 24) return t('{h}h {m}m', { h, m: String(r).padStart(2, '0') })
    return t('{d}d {h}h', { d: Math.floor(h / 24), h: h % 24 })
  }
  dur(m) { m = m || 0; return m < 60 ? t('{n}m', { n: m }) : t('{n}h', { n: Math.floor(m / 60) }) + (m % 60 ? ' ' + t('{n}m', { n: m % 60 }) : '') }
  dayOf(t2) {
    const d = new Date(t2), n = new Date()
    const diff = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY)
    return diff === 0 ? '' : diff === 1 ? t('Yesterday') : t('{n} days ago', { n: diff })
  }
  unit() { return this.state.settings.unit ?? this.props.unit ?? 'oz' }
  // household-level like unit — what the daily meds dose is called everywhere it renders.
  // Read-side default: households that never saved the key still say Vitamin D.
  medName() { return (this.state.settings.medName || '').trim() || t('Vitamin D') }
  // stored oz → the display unit's number; oz passes through untouched so the
  // current formatting survives. Every place an amount RENDERS goes through here.
  amt(oz) { return oz == null ? oz : this.unit() === 'ml' ? ozToMl(oz) : oz }
  // sheet amount state lives in the display unit; the wire string stays oz
  amountKey() { return this.unit() === 'ml' ? 'ml' : 'oz' }
  fmtDetail(d) {
    // wire strings stay canonical ('Left', 'breastmilk') — translate on the way out
    const { n, mins, side, milk, when } = dSplit(d), p = []
    if (n != null) p.push(this.amt(n) + ' ' + this.unit())
    if (milk) p.push(t(milk))
    if (side) p.push(t(side))
    if (when) p.push(t(when))
    if (mins != null) p.push(this.dur(mins))
    return p.join(' · ')
  }
  subFor(e, noDay) {
    const day = noDay ? '' : this.dayOf(startOf(e)), p = []
    if ((e.type === 'bottle' || e.type === 'pump') && e.detail != null) p.push(this.fmtDetail(e.detail) || String(e.detail))
    if (e.type === 'nurse') p.push(e.detail ? this.fmtDetail(e.detail) || String(e.detail) : t('either side'))
    if (e.type === 'sleep') {
      const w = dSplit(e.detail).when
      if (w) p.push(t(w))
      p.push(this.dur(sleepMins(e.detail) || 0))
    }
    if (e.type === 'tummy') p.push(this.dur(sleepMins(e.detail) || 0))
    if (DIAPERS.includes(e.type)) p.push(t(e.type === 'both' ? 'wet + dirty' : e.type))
    if (e.type === 'meds') p.push(this.medName())
    if (day) p.push(day)
    return p.filter(Boolean).join(' · ') || t('logged')
  }
  // real DOB wins over the onboarding age bucket; weeks first, then months, then years
  ageInfoFor(bd, fallbackLabel) {
    if (!bd) return { label: fallbackLabel ? t(fallbackLabel) : fallbackLabel, weeks: null }
    const days = Math.max(0, Math.floor((Date.now() - new Date(bd + 'T00:00:00').getTime()) / DAY))
    const weeks = Math.floor(days / 7), mo = Math.floor(days / 30.4375)
    const label = days < 183 ? t(weeks === 1 ? '{n} wk' : '{n} wks', { n: weeks })
      : mo < 24 ? t('{n} mo', { n: mo })
      : (mo % 12 ? t('{y}y {m}m', { y: Math.floor(mo / 12), m: mo % 12 }) : t('{n}y', { n: Math.floor(mo / 12) }))
    return { label, weeks }
  }
  // the SELECTED child's age — headers and age-norm insights follow the pills;
  // the pre-children mirrors keep old cached state working until the first sync
  ageInfo() {
    const c = this.selChild()
    return this.ageInfoFor(c ? c.birthdate : this.state.babyBirthdate, (c && c.age) || this.state.age)
  }
  setBirthdate = e => {
    const bd = e.target.value
    if (!bd) return
    this.setState({ babyBirthdate: bd })
    api.setBaby({ name: this.state.babyName || 'Baby', birthdate: bd }).catch(() => this.setState({ offline: true }))
  }
  // ── account (settings) ─────────────────────────────────────────────────────
  saveMyName = () => {
    const name = (this.state.acctName || '').trim()
    if (!name || !this.state.me || name === this.state.me.name) return
    // local-first like everything else: the header updates now, the partner on the next poke
    this.setState(s => ({ me: s.me ? { ...s.me, name } : s.me }))
    api.accountProfile(name).catch(() => this.setState({ offline: true }))
  }
  saveBabyName = () => {
    const name = (this.state.acctBabyName || '').trim()
    if (!name || name === this.state.babyName) return
    this.setState({ babyName: name })
    // setBaby only touches the fields it's sent — birthdate survives a rename
    api.setBaby({ name }).catch(() => this.setState({ offline: true }))
  }
  toggleAcct = which => this.setState(s => ({
    acctOpen: s.acctOpen === which ? null : which,
    acctError: null, acctEmail: '', acctEmailPw: '', acctPwCur: '', acctPwNew: '',
  }))
  acctFail = e => {
    const first = e.errors ? Object.values(e.errors)[0]?.[0] : null
    this.setState({
      acctBusy: false,
      acctError: e.status ? (first || e.message || t('That didn’t go through — try again.')) : t('No signal — try again in a moment.'),
    })
  }
  submitAcctEmail = async () => {
    const s = this.state
    const email = s.acctEmail.trim()
    if (!email || !s.acctEmailPw || s.acctBusy) return
    this.setState({ acctBusy: true, acctError: null })
    try {
      const r = await api.accountEmail({ email, password: s.acctEmailPw })
      this.setState(st => ({
        acctBusy: false, acctOpen: null, acctEmail: '', acctEmailPw: '',
        me: st.me ? { ...st.me, email: r.email } : st.me,
        toast: t('Email updated — log in with {email} next time', { email: r.email }), undoAction: null,
      }))
      this.bumpToast()
    } catch (e) { this.acctFail(e) }
  }
  submitAcctPassword = async () => {
    const s = this.state
    if (!s.acctPwCur || !s.acctPwNew || s.acctBusy) return
    if (s.acctPwNew.length < 8) return this.setState({ acctError: t('Pick a password with at least 8 characters.') })
    this.setState({ acctBusy: true, acctError: null })
    try {
      await api.accountPassword({ current_password: s.acctPwCur, password: s.acctPwNew })
      this.setState({
        acctBusy: false, acctOpen: null, acctPwCur: '', acctPwNew: '',
        toast: t('Password updated — other phones will need to log in again'), undoAction: null,
      })
      this.bumpToast()
    } catch (e) { this.acctFail(e) }
  }

  // ── API access (settings; every role — the server scopes tokens to their maker)
  toggleTokens = () => {
    const opening = !this.state.tokensOpen
    this.setState({ tokensOpen: opening, revokeTokenArmId: null })
    // lazy: tokens are deliberately not in /state — first expand pulls them
    if (opening && this.state.apiTokens == null) this.fetchTokens()
  }
  fetchTokens = () => api.tokens()
    .then(r => this.setState({ apiTokens: r.tokens, apiScopes: r.scopes }))
    .catch(e => this.setState(e.status ? { tokenError: e.message || t('That didn’t go through — try again.') } : { offline: true }))
  createApiToken = async () => {
    const s = this.state
    const name = s.tokenName.trim()
    if (!name || !s.tokenScopes.length || s.tokenBusy) return
    this.setState({ tokenBusy: true, tokenError: null })
    try {
      const r = await api.createToken({ name, abilities: s.tokenScopes, expires_in_days: s.tokenExpiry })
      this.setState({
        tokenBusy: false, tokenAddOpen: false, tokenName: '', tokenScopes: [], tokenExpiry: 90,
        newToken: r.token, // plaintext — the server never shows it again
      })
      this.fetchTokens()
    } catch (e) {
      const first = e.errors ? Object.values(e.errors)[0]?.[0] : null
      this.setState({
        tokenBusy: false,
        tokenError: e.status ? (first || e.message || t('That didn’t go through — try again.')) : t('No signal — try again in a moment.'),
      })
    }
  }
  revokeApiToken = id => {
    this.setState(s => ({ revokeTokenArmId: null, apiTokens: (s.apiTokens || []).filter(x => x.id !== id) }))
    api.revokeToken(id).then(() => this.fetchTokens()).catch(e => {
      if (e.status) {
        this.setState({ tokenError: e.message || t('That didn’t go through — try again.') })
        this.fetchTokens() // fall back to server truth
      } else this.setState({ offline: true })
    })
  }
  copyApiToken = () => {
    try { navigator.clipboard.writeText(this.state.newToken).catch(() => { /* stays on screen to copy by hand */ }) } catch { /* no clipboard API */ }
    this.setState({ toast: t('Token copied — keep it somewhere safe'), undoAction: null })
    this.bumpToast()
  }

  // ── Home Assistant / MQTT bridge (settings; parents only — the server 403s caregivers)
  toggleMqtt = () => {
    const opening = !this.state.mqttOpen
    this.setState({ mqttOpen: opening, mqttTestResult: null, mqttError: null })
    // lazy: broker config is deliberately not in /state — first expand pulls it
    if (opening && this.state.mqttCfg == null) this.fetchMqtt()
  }
  fetchMqtt = () => api.mqttGet()
    .then(r => this.setState({
      mqttCfg: { ...r.config, heartbeatAt: r.status?.heartbeatAt ?? null },
      mqttForm: this.mqttFormFrom(r.config),
    }))
    .catch(e => this.setState(e.status ? { mqttError: e.message || t('That didn’t go through — try again.') } : { offline: true }))
  mqttFormFrom(c) {
    // password stays blank — an empty field means “keep the stored one” on save
    return { enabled: !!c.enabled, host: c.host || '', port: c.port ?? 1883, username: c.username || '', password: '', tls: !!c.tls, tls_verify: c.tls_verify !== false }
  }
  mqttBody() {
    const f = this.state.mqttForm
    return {
      enabled: f.enabled, host: f.host.trim(), port: f.port === '' ? null : Number(f.port),
      username: f.username.trim(), ...(f.password ? { password: f.password } : {}),
      tls: f.tls, tls_verify: f.tls_verify,
    }
  }
  setMqttForm = patch => this.setState(s => ({ mqttForm: { ...s.mqttForm, ...patch }, mqttError: null, mqttTestResult: null }))
  saveMqtt = async () => {
    if (!this.state.mqttForm || this.state.mqttBusy) return
    this.setState({ mqttBusy: true, mqttError: null, mqttTestResult: null })
    try {
      const r = await api.mqttSave(this.mqttBody())
      this.setState(s => ({
        mqttBusy: false,
        mqttCfg: { ...r.config, heartbeatAt: s.mqttCfg?.heartbeatAt ?? null },
        mqttForm: this.mqttFormFrom(r.config),
      }))
    } catch (e) {
      this.setState({
        mqttBusy: false,
        mqttError: e.status ? (e.message || t('That didn’t go through — try again.')) : t('No signal — try again in a moment.'),
      })
    }
  }
  testMqtt = async () => {
    if (!this.state.mqttForm || this.state.mqttBusy) return
    this.setState({ mqttBusy: true, mqttError: null, mqttTestResult: null })
    try {
      const r = await api.mqttTest(this.mqttBody())
      this.setState({ mqttBusy: false, mqttTestResult: r.ok ? { ok: true } : { ok: false, message: r.message || t('Couldn’t reach the broker.') } })
    } catch (e) {
      this.setState({
        mqttBusy: false,
        mqttError: e.status ? (e.message || t('That didn’t go through — try again.')) : t('No signal — try again in a moment.'),
      })
    }
  }

  trackOn(key) { return this.state.settings.tracking[key] !== false }
  typeOn(typeKey) {
    const tr = TRACKS.find(t => t.types.includes(typeKey))
    return !tr || this.trackOn(tr.key)
  }
  setTracking = (key, on) => this.setState(s => ({
    settings: { ...s.settings, tracking: { ...s.settings.tracking, [key]: on } },
    settingsDirty: true,
  }), () => this.flushSoon())
  // widgets shown on Now: the household's chosen set (or the default), then
  // filtered so a card can't outlive the tracker it depends on
  widgetKeys() {
    const w = this.state.settings.widgets
    const chosen = Array.isArray(w) && w.length ? w : DEFAULT_WIDGETS
    return chosen.filter(k => { const wid = WIDGETS.find(x => x.key === k); return wid && (!wid.track || this.trackOn(wid.track)) })
  }
  setWidget = (key, on) => this.setState(s => {
    const cur = Array.isArray(s.settings.widgets) && s.settings.widgets.length ? s.settings.widgets : this.widgetKeys()
    const set = new Set(on ? [...cur, key] : cur.filter(k => k !== key))
    const widgets = WIDGETS.map(w => w.key).filter(k => set.has(k)) // normalize to catalog order
    return { settings: { ...s.settings, widgets }, settingsDirty: true }
  }, () => this.flushSoon())
  dismissRec = key => this.setState(s => ({
    settings: { ...s.settings, dismissed: [...new Set([...s.settings.dismissed, key])] },
    settingsDirty: true,
  }), () => this.flushSoon())
  setTheme = patch => this.setState(s => ({
    settings: { ...s.settings, theme: { ...(s.settings.theme || {}), ...patch } },
    settingsDirty: true,
  }), () => this.flushSoon())
  // household-level like tracking/theme — both parents should read the same numbers
  setUnit = unit => this.setState(s => ({
    settings: { ...s.settings, unit },
    settingsDirty: true,
  }), () => this.flushSoon())
  setMedName = e => this.setState(s => ({
    settings: { ...s.settings, medName: e.target.value },
    settingsDirty: true,
  }), () => this.flushSoon())
  // theme mode & tilt are per-phone (fx.js), not household settings — the
  // night-shift parent going dark shouldn't flip their partner's screen
  // note: Android's installed-app status bar follows the OS scheme only
  // (ColorUtils.inNightMode) — no page-side action can recolor it, so don't
  // bother reloading or rewriting metas beyond what applyTheme already does
  setFxMode = mode => this.setState({ fx: setFx({ mode }) })
  toggleTilt = async () => {
    const on = !this.state.fx.tilt
    if (on) await askTiltPermission() // iOS wants the request inside this tap
    this.setState({ fx: setFx({ tilt: on }) })
  }
  feedGap() {
    // rhythm runs between session starts — cluster feeds don't count as new beats
    const t = this.live().filter(e => FEEDS.includes(e.type)).map(e => e.t).sort((a, b) => a - b)
    const starts = sessionStarts(t).slice(-14)
    const gaps = []; for (let i = 1; i < starts.length; i++) gaps.push(starts[i] - starts[i - 1])
    // whole ms: plan timestamps built from this go to the server as integers
    return gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 3 * 3600000
  }
  // items the last shift's plan never got to. Feeds are deliberately excluded:
  // a feed isn't owed, it's rhythmic — the next one is always re-predicted from
  // the last one that actually happened. A dose of anything *is* owed, and
  // shouldn't evaporate because duty changed hands at 4am.
  carryOver() {
    const sh = this.state.serverShift
    if (!sh || !Array.isArray(sh.plan) || !sh.plan.length) return []
    const from = sh.started_at || 0, to = sh.ended_at || Date.now()
    const done = this.live().filter(e => e.t >= from && e.t <= to).sort((a, b) => a.t - b.t)
    const matched = new Set()
    return sh.plan.filter(p => {
      if (FEEDS.includes(p.type)) return false
      const hit = done.find(e => e.type === p.type && !matched.has(e.id))
      if (hit) matched.add(hit.id)
      return !hit
    })
  }
  draftPlan() {
    const gap = this.feedGap(), feed = this.lastOf(FEEDS), now = Date.now()
    let t1 = (feed ? feed.t : now) + gap; while (t1 < now + 20 * 60000) t1 += gap
    // unfinished items keep their original time, so the checklist shows them
    // running late rather than quietly rescheduling what someone missed
    const carried = this.carryOver()
    const out = [...carried, { id: 'p1', type: 'bottle', at: t1 }, { id: 'p2', type: 'bottle', at: t1 + gap }]
    const meds = new Date(); meds.setHours(9, 0, 0, 0); if (meds.getTime() < now) meds.setDate(meds.getDate() + 1)
    if (this.trackOn('meds') && meds.getTime() - now < 11 * 3600000 && !carried.some(p => p.type === 'meds')) {
      out.push({ id: 'p3', type: 'meds', at: meds.getTime() })
    }
    return out.sort((a, b) => a.at - b.at)
  }
  // "Until 6 AM" → the next matching clock time as ms epoch, resolved here in
  // the accepter's own timezone; wake-dependent / open-ended labels have no
  // alarm time, so they return null and the server's until-ping never fires
  untilAt(label) {
    const m = /until\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(label || '')
    if (!m) return null
    let h = Number(m[1])
    if (m[3]) h = h % 12 + (m[3].toLowerCase() === 'pm' ? 12 : 0)
    const d = new Date(); d.setHours(h, Number(m[2] || 0), 0, 0)
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
    return d.getTime()
  }
  lastOf(keys) { return this.live().filter(e => keys.includes(e.type)).sort((a, b) => b.t - a.t)[0] }

  // ── nursing / pump / sleep timers (server-backed, live) ────────────────────
  stopwatch(ms) {
    const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
    const pad = n => String(n).padStart(2, '0')
    return (h ? h + ':' + pad(m) : m) + ':' + pad(ss)
  }
  startTimer = type => {
    // pre-picked nurse side (if any) is remembered locally for the stop log
    const side = type === 'nurse' ? (this.state.detail || this.defaultDetail('nurse')) : null
    // the sheet's child chip (when >1 child) decides who this session is for
    const babyId = this.state.sheetChildId ?? this.selChildId()
    // client-generated id, entry-style — the optimistic row IS the server timer,
    // so a reconcile mid-flight can't duplicate it
    const id = uuid()
    this._timerBusy++
    this.closeSheet() // animated close that also consumes the {blSheet} history entry
    this.setState(s => ({
      manualDur: false,
      activeTimers: [...s.activeTimers, { id, type, started_at: Date.now(), user_id: s.me?.id, baby_id: babyId }],
      timerSides: side ? { ...s.timerSides, [id]: side } : s.timerSides,
    }))
    api.timerStart(type, babyId, id)
      .then(r => this.setState(s => {
        // the server may hand back an already-running identical session
        // (double-tap) — adopt its copy either way, carrying the side across
        const timerSides = { ...s.timerSides }
        if (r.timer.id !== id && timerSides[id] != null) {
          if (timerSides[r.timer.id] == null) timerSides[r.timer.id] = timerSides[id]
          delete timerSides[id]
        }
        const rest = s.activeTimers.filter(t => t.id !== id && t.id !== r.timer.id)
        return { activeTimers: [...rest, r.timer].sort((a, b) => (a.started_at || 0) - (b.started_at || 0)), timerSides }
      }))
      .catch(() => this.setState({ offline: true }))
      .finally(() => { this._timerBusy-- })
  }
  stopTimer = id => {
    const tm = this.state.activeTimers.find(x => x.id === id)
    if (!tm) return
    // Anyone in the household can stop any timer: a nap outlives the handoff
    // that happens mid-nap, and "only the starter can stop" stranded whoever
    // came on duty. The session still belongs to the person who ran it, so the
    // logged entry names them, not whoever was free to press Stop.
    const by = tm.user_id ?? this.state.me?.id
    const mins = Math.max(1, Math.round((Date.now() - tm.started_at) / 60000))
    // the nurse side is remembered per-device against the timer id, so stopping
    // someone else's session falls back to the default rather than their pick
    const side = this.state.timerSides[id]
    this._timerBusy++
    this.setState(s => {
      const timerSides = { ...s.timerSides }
      delete timerSides[id]
      return { activeTimers: s.activeTimers.filter(x => x.id !== id), timerSides }
    })
    api.timerStop(id).catch(() => this.setState({ offline: true })).finally(() => { this._timerBusy-- })
    // the entry belongs to the child the timer was started for — pill switches
    // mid-session must not redirect the log (null-era timers → primary child)
    const timerBabyId = tm.baby_id ?? this.primaryChildId()
    if (tm.type === 'nurse') {
      // nursing: measured side + duration log straight away, undo available
      const detail = [side || this.defaultDetail('nurse'), mins + 'm'].filter(Boolean).join(' · ')
      const entry = { id: uuid(), type: 'nurse', t: tm.started_at, detail, by, babyId: timerBabyId }
      this.setState(s => ({
        entries: [entry, ...s.entries], outbox: [...s.outbox, entry.id],
        toast: t('Nursing logged · {dur}', { dur: this.dur(mins) }), undoAction: { kind: 'add', id: entry.id },
      }), () => this.flushSoon())
      this.bumpToast()
    } else if (tm.type === 'sleep' || tm.type === 'tummy') {
      // sleep/tummy time: the entry stamps the moment the session ended, and
      // the duration leads the detail as bare minutes (the sleep format — the
      // wake-window insight subtracts it from t to find when the nap started).
      // A nap/night tag is an edit-time refinement, so the timer stays untagged.
      const entry = { id: uuid(), type: tm.type, t: Date.now(), detail: mins, by, babyId: timerBabyId }
      this.setState(s => ({
        entries: [entry, ...s.entries], outbox: [...s.outbox, entry.id],
        toast: t(tm.type === 'sleep' ? 'Sleep logged · {dur}' : 'Tummy time logged · {dur}', { dur: this.dur(mins) }),
        undoAction: { kind: 'add', id: entry.id },
      }), () => this.flushSoon())
      this.bumpToast()
    } else {
      // pumping needs the amount — open the sheet (manual mode) with the timed duration filled in
      this._base = tm.started_at
      const last = this.lastOf(['pump'])
      this.mountSheet({
        editId: null, sel: 'pump', offset: 0, pickedT: null, dayPicked: false, manualDur: true, sheetChildId: timerBabyId,
        detail: this.amt(last ? (dSplit(last.detail).n ?? 4) : 4), detail2: mins,
        // the pump was theirs even if you're the one entering the amount
        sheetAuthorId: by,
      })
    }
  }

  // ── shifts (server-backed) ─────────────────────────────────────────────────
  // a server rejection is not "offline": say why, and fall back to server truth
  // instead of leaving optimistic duty state that quietly reverts on the next pull
  shiftFail = e => {
    if (e && e.status) {
      const first = e.errors ? Object.values(e.errors)[0]?.[0] : null
      this.setState({ toast: first || e.message || t('That didn’t go through — try again'), undoAction: null })
      this.bumpToast()
      this.sync()
    } else this.setState({ offline: true })
  }
  // every shift-sheet opening routes through here — same lifecycle as mountSheet:
  // slide-up entrance (mount off-screen, translate home two frames later) plus a
  // {blShift} history entry so the Android back gesture closes it
  mountShift = fields => {
    if (this._shiftTo) { clearTimeout(this._shiftTo); this._shiftTo = null }
    if (!this.state.shiftOpen && !window.history.state?.blShift) {
      try { window.history.pushState({ blShift: true }, '') } catch { /* history blocked — back just exits */ }
    }
    this.setState(s => ({ shiftOpen: true, shiftLeaving: false, shiftIn: reduceMotion(), shiftDragY: 0, shiftDragging: false, ...(typeof fields === 'function' ? fields(s) : fields) }))
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (this.state.shiftOpen) this.setState({ shiftIn: true })
    }))
  }
  openShift = () => {
    if (!this.state.partner) return // no one to hand to yet
    this.mountShift(s => ({ shiftMode: null, planDraft: s.planDraft || this.draftPlan(), planAddOpen: null }))
  }
  // composing a handoff: the plan, window, and note the *asker* is proposing.
  // This used to be a one-tap link that fired prose — there was nothing to
  // author, which is most of why it went unused.
  openAsk = () => {
    if (!this.state.partner) return
    this.mountShift(s => ({ shiftMode: 'ask', planDraft: s.planDraft || this.draftPlan(), planOff: [], planAddOpen: null }))
  }
  sendAsk = () => {
    const s = this.state
    const plan = (s.planDraft || this.draftPlan()).filter(p => !s.planOff.includes(p.id))
    const until = s.until, untilAt = this.untilAt(until)
    const note = s.askNote
    const target = s.askTarget != null ? this.memberById(s.askTarget) : null
    const others = s.members.filter(m => s.me && m.id !== s.me.id)
    this.closeShift()
    this.setState(st => ({
      shiftMode: null, planDraft: null, planOff: [],
      serverShift: { id: -3, state: 'requested', requester_id: st.me?.id, target_id: target?.id ?? null, note, plan, until, until_at: untilAt, requested_at: Date.now() },
      toast: target
        ? t('{who} will get your handoff ask', { who: target.name })
        : t('{who} will get your handoff ask', { who: others.length > 1 ? t('Everyone else') : (st.partner?.name || t('Your partner')) }),
      undoAction: null,
    }), () => this.bumpToast())
    api.shiftRequest(note, plan, until, untilAt, target?.id ?? null).catch(this.shiftFail)
  }
  closeShift = () => {
    // consume our history entry when it's on top; the popstate runs the
    // animated close, same as a native back gesture would
    if (this.state.shiftOpen && window.history.state?.blShift) return window.history.back()
    this.dismissShift()
  }
  dismissShift = () => {
    if (!this.state.shiftOpen) return
    // clearing the drag here (not in the gesture's end) is what lets the exit
    // animate: dragging pins `transition:none`, so it has to lift before the
    // sheet is told to slide the rest of the way down
    this.setState({ shiftOpen: false, shiftIn: false, shiftLeaving: true, shiftDragY: 0, shiftDragging: false })
    this._shiftTo = setTimeout(() => {
      this._shiftTo = null
      // marking the report dismissed waits for the exit — flipping it earlier
      // would swap the report to the take-over view mid-slide
      this.setState(s => ({
        shiftLeaving: false,
        shiftMode: null, // a closed sheet always reopens on its default framing
        dismissedShiftId: (s.serverShift && s.serverShift.state === 'completed') ? s.serverShift.id : s.dismissedShiftId,
      }))
    }, reduceMotion() ? 0 : 340)
  }
  acceptShift = () => {
    const s = this.state
    // the same draft the incoming card and the sheet render: what you were
    // shown (and may have edited) is what gets submitted. Accepting straight
    // from the card used to send this device's own guess instead.
    const plan = (s.planDraft || this.draftPlan()).filter(p => !s.planOff.includes(p.id))
    const until = s.until
    const untilAt = this.untilAt(until)
    this.closeShift()
    this.setState(st => {
      // name whoever's being relieved: the requester of a pending ask, else the
      // previous duty holder — with two members both are just "the partner"
      const fromId = st.serverShift?.state === 'requested' ? st.serverShift.requester_id
        : (st.onDutyUserId !== st.me?.id ? st.onDutyUserId : null)
      return {
        shift: undefined, handbackNote: '', askNote: '', askTarget: null, shiftMode: null, plan, planDraft: null, planOff: [],
        onDutyUserId: st.me?.id ?? st.onDutyUserId,
        serverShift: { id: st.serverShift?.id ?? -1, state: 'active', user_id: st.me?.id, requester_id: st.serverShift?.state === 'requested' ? st.serverShift.requester_id : null, plan, until, until_at: untilAt, started_at: Date.now() },
        // starting a shift while already holding duty isn't a takeover — don't
        // announce a change that didn't happen
        toast: t(fromId ? 'You’re on duty · {name} notified' : 'Shift started · {name} notified',
          { name: this.memberName(fromId, st.partner?.name) || st.partner?.name || t('your partner') }), undoAction: null,
      }
    }, () => this.bumpToast())
    api.shiftAccept(plan, until, untilAt).then(r => this.setState({ serverShift: r.shift })).catch(this.shiftFail)
  }
  // ── plan editing ───────────────────────────────────────────────────────────
  // Two plans take the same three operations: the *draft* you're composing a
  // handoff with (or about to accept), and the *live* plan on your running
  // shift, which pushes through /shifts/plan. A drafted plan used to be
  // take-it-or-leave-it — fine when it was only a machine guess, wrong once the
  // person handing off is the one authoring it.
  editPlan = (scope, fn) => {
    const sort = p => [...p].sort((a, b) => a.at - b.at)
    if (scope === 'live') {
      this.setState(
        s => { const plan = sort(fn(s.plan)); return { plan, serverShift: s.serverShift ? { ...s.serverShift, plan } : s.serverShift } },
        () => api.shiftPlan(this.state.plan).catch(this.shiftFail),
      )
    } else {
      this.setState(s => ({ planDraft: sort(fn(s.planDraft || this.draftPlan())) }))
    }
  }
  // a picked "HH:MM" is a clock time near the one it replaces; dragging it well
  // back past now means you meant tomorrow's, the same rule the "until" labels use
  planAt(hm, was) {
    const [h, m] = String(hm || '').split(':').map(Number)
    if (!Number.isFinite(h) || !Number.isFinite(m)) return was
    const d = new Date(was); d.setHours(h, m, 0, 0)
    if (d.getTime() < Date.now() - 12 * 3600000) d.setDate(d.getDate() + 1)
    return d.getTime()
  }
  setPlanTime = (scope, id) => e => {
    const hm = e.target.value
    this.editPlan(scope, plan => plan.map(p => (p.id === id ? { ...p, at: this.planAt(hm, p.at) } : p)))
  }
  removePlanItem = (scope, id) => () => this.editPlan(scope, plan => plan.filter(p => p.id !== id))
  addPlanItem = (scope, type) => () => {
    this.setState({ planAddOpen: null })
    this.editPlan(scope, plan => {
      // a feed lands one rhythm-gap after the last planned feed; anything else
      // is a one-off with no rhythm to infer, so it starts an hour out and
      // waits for you to set the time you actually mean
      const lastFeed = plan.filter(p => FEEDS.includes(p.type)).sort((a, b) => b.at - a.at)[0]
      const at = FEEDS.includes(type)
        ? (lastFeed ? lastFeed.at : Date.now()) + this.feedGap()
        : Date.now() + 3600000
      return [...plan, { id: 'p' + Date.now(), type, at }]
    })
  }
  handBack = () => {
    const note = this.state.handbackNote
    this.setState(s => {
      // duty returns to the shift's stored requester (the server's rule too);
      // a self-started shift or a gone requester falls back to the first other
      const sh = s.serverShift
      const reqId = sh && sh.state === 'active' && sh.user_id === s.me?.id ? sh.requester_id : null
      const backTo = (reqId && reqId !== s.me?.id && this.memberById(reqId)) ? reqId : (s.partner?.id ?? s.onDutyUserId)
      return {
        plan: [],
        serverShift: sh && sh.state === 'active'
          ? { ...sh, state: 'completed', ended_at: Date.now(), handback_note: note }
          : { id: -2, state: 'completed', user_id: s.me?.id, started_at: sh?.started_at ?? Date.now(), ended_at: Date.now(), handback_note: note },
        onDutyUserId: backTo,
      }
    })
    api.shiftHandback(note).then(r => { if (r.shift) this.setState({ serverShift: r.shift }) }).catch(this.shiftFail)
  }
  // "Ask again" — re-send the ask that's already outstanding, which the server
  // treats as a deliberate nudge (refresh + re-ping). Nothing about it changes,
  // so it resends the ask's own plan and note rather than whatever happens to
  // be typed elsewhere in the sheet.
  requestHandoff = () => {
    const s = this.state, sh = s.serverShift
    const pending = sh && sh.state === 'requested' && s.me && sh.requester_id === s.me.id ? sh : null
    if (!pending) return this.openAsk() // nothing outstanding — compose one instead
    const to = pending.target_id != null ? this.memberById(pending.target_id) : null
    const others = s.members.filter(m => s.me && m.id !== s.me.id)
    this.closeShift()
    this.setState({
      toast: t('{who} will get your handoff ask', {
        who: to ? to.name : (others.length > 1 ? t('Everyone else') : (s.partner?.name || t('Your partner'))),
      }), undoAction: null,
    }, () => this.bumpToast())
    api.shiftRequest(pending.note, pending.plan || [], pending.until, pending.until_at, pending.target_id ?? null).catch(this.shiftFail)
  }

  // ── quick-log sheet ────────────────────────────────────────────────────────
  predict() {
    if ((this.props.smartPrefill ?? true) === false) return null
    const feed = this.lastOf(FEEDS), dia = this.lastOf(DIAPERS)
    if (!feed && !dia) return 'bottle'
    if (!this.trackOn('diapers')) return feed && feed.type === 'nurse' ? 'nurse' : 'bottle'
    const fMin = feed ? (Date.now() - feed.t) / 60000 : 999
    const dMin = dia ? (Date.now() - dia.t) / 60000 : 999
    if (fMin / 165 >= dMin / 150) return feed && feed.type === 'nurse' ? 'nurse' : 'bottle'
    return 'wet'
  }
  // the sheet shows and picks a session's START, like every other type, while
  // the wire stamps a sleep/tummy session's END. Which of the two the sheet
  // holds still while the duration changes depends on how it was opened:
  //  - a fresh sheet anchors on now as the END ("baby just woke up, slept
  //    45m") — a longer duration reaches further back rather than into the
  //    future, and a nudge is "ended 15m ago"
  //  - a picked time, or an edit, anchors on the START the sheet shows — the
  //    parent typed 9:00 PM, so a longer duration moves the wake-up, never the
  //    time they just typed
  anchorsStart() { return this.state.pickedT != null || !!this.state.editId }
  stamp() {
    const a = this.state.pickedT ?? this._base + this.state.offset * 60000
    return this.anchorsStart() ? a + this.stampShift() : a
  }
  shownStamp() { return this.stamp() - this.stampShift() }
  // the gap between the wire stamp and the shown start: 0 for everything except
  // a sleep/tummy sheet, where it's the duration currently on the scrub
  stampShift(k) {
    k = k || this.state.sel
    return SPANS.includes(k) ? (sleepMins(this.composeDetail(k)) || 0) * 60000 : 0
  }
  // whether the day on the sheet is one the parent chose (Advanced → Day, or
  // an edit, where the entry's own day is the point) rather than one the
  // sheet derived from now
  dayPicked() { return !!this.state.editId || !!this.state.dayPicked }

  openSheet = () => {
    this._base = Date.now()
    const k = this.predict()
    // the sheet's child chip row starts on whoever the pills are showing
    this.mountSheet({ editId: null, sel: k, offset: 0, pickedT: null, dayPicked: false, detail: k ? this.defaultDetail(k) : null, detail2: k ? this.defaultDetail2(k) : null, manualDur: false, sheetChildId: this.selChildId() })
  }
  defaultDetail(k) {
    const d = T(k).detail
    if (d === 'amount') { const l = this.lastOf([k]); return this.amt(l ? (dSplit(l.detail).n ?? 4) : 4) } // seeds in the display unit
    if (d === 'side') { const l = this.lastOf(['nurse']); return l && dSplit(l.detail).side === 'Left' ? 'Right' : 'Left' }
    if (d === 'dur') return k === 'tummy' ? 10 : 45
    return null
  }
  defaultDetail2(k) {
    if (k === 'bottle') { const l = this.lastOf(['bottle']); return l ? dSplit(l.detail).milk : null }
    return null
  }
  // ── provider export: CSV through the native share sheet (download fallback) ─
  exportRows() {
    const who = {}
    // former members first, so a live member's row wins if an id ever repeats
    for (const u of [...(this.state.formerMembers || []), this.state.me, this.state.partner, ...(this.state.members || [])]) if (u) who[u.id] = u.name || ''
    const pad = n => String(n).padStart(2, '0')
    // range chips: 7/30 count back from local midnight so "7 days" means the
    // bars' window (today + 6 before), 'all' is everything on the device
    const r = this.state.exportRange
    let from = 0
    if (r !== 'all') { const d = new Date(); d.setHours(0, 0, 0, 0); from = d.getTime() - (r - 1) * DAY }
    // rows carry the start of each session (a nap sits on the day it began), so
    // the date column can never fall outside the range the chips asked for
    return this.live().filter(e => startOf(e) >= from).sort((a, b) => startOf(a) - startOf(b)).map(e => {
      const d = dSplit(e.detail), dt = new Date(startOf(e))
      return {
        key: e.type,
        date: dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()),
        time: pad(dt.getHours()) + ':' + pad(dt.getMinutes()),
        type: t(T(e.type).label),
        oz: ['bottle', 'pump'].includes(e.type) ? d.n : null,
        mins: ['sleep', 'tummy'].includes(e.type) ? sleepMins(e.detail) : d.mins,
        note: [d.side && t(d.side), d.milk && t(d.milk), d.when && t(d.when)].filter(Boolean).join(' · '),
        by: who[e.by] || '',
      }
    })
  }
  shareCsv = async (name, lines) => {
    const file = new File([lines.join('\r\n') + '\r\n'], name, { type: 'text/csv' })
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return } catch { /* declined or unsupported — fall back */ }
    }
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url; a.download = name; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
  exportName(kind) {
    const day = new Date().toISOString().slice(0, 10)
    // exports read live(), so the file carries the selected child's name
    const name = this.selChild()?.name || this.state.babyName || ''
    return ['mybabynotes', name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), kind, day].filter(Boolean).join('-') + '.csv'
  }
  exportLog = () => {
    this.shareCsv(this.exportName('full'), [
      t('Date,Time,Type,Amount ({unit}),Duration (min),Detail,Logged by', { unit: this.unit() }),
      ...this.exportRows().map(r => [r.date, r.time, r.type, this.amt(r.oz) ?? '', r.mins ?? '', csvEsc(r.note), csvEsc(r.by)].join(',')),
    ])
  }
  exportSummary = () => {
    const days = new Map()
    for (const r of this.exportRows()) {
      let d = days.get(r.date)
      if (!d) days.set(r.date, d = { feeds: 0, oz: 0, nurseMin: 0, pumpOz: 0, wet: 0, dirty: 0, sleepMin: 0, tummyMin: 0, baths: 0, meds: 0 })
      if (r.key === 'bottle') { d.feeds++; d.oz += r.oz || 0 }
      if (r.key === 'nurse') { d.feeds++; d.nurseMin += r.mins || 0 }
      if (r.key === 'pump') d.pumpOz += r.oz || 0
      if (r.key === 'wet' || r.key === 'both') d.wet++
      if (r.key === 'dirty' || r.key === 'both') d.dirty++
      if (r.key === 'sleep') d.sleepMin += r.mins || 0
      if (r.key === 'tummy') d.tummyMin += r.mins || 0
      if (r.key === 'bath') d.baths++
      if (r.key === 'meds') d.meds++
    }
    // day totals sum in oz and convert once at the end — no per-row rounding drift
    this.shareCsv(this.exportName('daily'), [
      t('Date,Feeds,Bottle ({unit}),Nursing (min),Pumped ({unit}),Wet diapers,Dirty diapers,Sleep (min),Tummy time (min),Baths,Meds', { unit: this.unit() }),
      ...[...days.entries()].map(([date, d]) =>
        [date, d.feeds, d.oz ? this.amt(d.oz) : '', d.nurseMin || '', d.pumpOz ? this.amt(d.pumpOz) : '', d.wet, d.dirty, d.sleepMin || '', d.tummyMin || '', d.baths || '', d.meds || ''].join(',')),
    ])
  }

  // Baby Buddy CSV import (Settings): per-model export files → entries. Ids are
  // deterministic from the source rows (src/bbimport.js), and POST /entries is
  // an upsert keyed on id — so a re-import can only re-write identical entries,
  // never duplicate them; anything already in the local log counts as skipped.
  importBabyBuddy = async input => {
    const files = [...(input.files || [])]
    input.value = '' // let the same file be picked again later
    if (!files.length || this.state.importBusy) return
    this.setState({ importBusy: true })
    let result = null
    try {
      result = mapBabyBuddy(await Promise.all(files.map(async f => ({ name: f.name, text: await f.text() }))))
    } catch { /* unreadable file — fall through to the empty-result toast */ }
    if (!result || (!result.entries.length && !result.skipped)) {
      this.setState({ importBusy: false, toast: t('Nothing recognized — pick the CSV files Baby Buddy exports'), undoAction: null })
      return this.bumpToast()
    }
    // imported history lands on the child being viewed when the import ran
    const importBabyId = this.selChildId()
    this.setState(s => {
      const have = new Set(s.entries.map(e => e.id))
      const fresh = result.entries.filter(e => !have.has(e.id)).map(e => ({ ...e, by: s.me?.id, babyId: importBabyId }))
      const skipped = result.skipped + (result.entries.length - fresh.length)
      return {
        importBusy: false,
        entries: [...fresh, ...s.entries].sort((a, b) => b.t - a.t),
        outbox: [...s.outbox, ...fresh.map(e => e.id)],
        toast: (fresh.length === 1 ? t('Imported 1 entry') : t('Imported {n} entries', { n: fresh.length })) + (skipped ? ' · ' + t('{n} skipped', { n: skipped }) : ''),
        undoAction: null,
      }
    }, () => this.flushSoon())
    this.bumpToast()
  }

  // detail state ↔ wire string: primary (amount/side/duration) in `detail`, extra (milk/minutes) in `detail2`
  // Amounts sit in the display unit while the sheet is open; the wire string is ALWAYS oz.
  composeDetail(k) {
    let a = this.state.detail
    const b = this.state.detail2
    if ((k === 'bottle' || k === 'pump') && a != null && a !== '' && this.unit() === 'ml') a = mlToOz(Number(a) || 0)
    if (k === 'bottle') return [a, b].filter(x => x != null && x !== '').join(' ') || null
    if (k === 'nurse' || k === 'pump') return [a, b != null ? b + 'm' : null].filter(x => x != null && x !== '').join(' · ') || null
    // tagged sleep reads like nurse ("Nap · 45m"); untagged keeps the legacy bare minutes
    if (k === 'sleep') return b != null && a != null && a !== '' ? b + ' · ' + a + 'm' : a
    return a
  }
  decompose(type, d) {
    const { n, mins, side, milk, when } = dSplit(d)
    if (type === 'bottle') return { detail: this.amt(n), detail2: milk }
    if (type === 'nurse') return { detail: side, detail2: mins }
    if (type === 'pump') return { detail: this.amt(n), detail2: mins }
    if (type === 'sleep') return { detail: mins ?? n, detail2: when }
    if (type === 'tummy') return { detail: mins ?? n, detail2: null }
    return { detail: d, detail2: null }
  }
  // every sheet opening routes through here: slide-up entrance (mount off-screen,
  // then translate home two frames later) plus a history entry so the Android
  // back gesture dismisses the sheet instead of exiting the app
  mountSheet = fields => {
    if (this._sheetTo) { clearTimeout(this._sheetTo); this._sheetTo = null }
    if (!this.state.sheet && !window.history.state?.blSheet) {
      try { window.history.pushState({ blSheet: true }, '') } catch { /* history blocked — back just exits */ }
    }
    // sheetAuthorId defaults to null on every open — only a timer stop passes
    // one, and a stale value must never re-credit the next thing logged here
    this.setState({ sheet: true, sheetLeaving: false, sheetIn: reduceMotion(), sheetTall: false, sheetDragY: 0, sheetDragging: false, advanced: !!this.state.advancedDefault, sheetAuthorId: null, ...fields })
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (this.state.sheet) this.setState({ sheetIn: true })
    }))
  }
  closeSheet = () => {
    // consume our history entry when it's on top; the popstate runs the
    // animated close, same as a native back gesture would
    if (this.state.sheet && window.history.state?.blSheet) return window.history.back()
    this.dismissSheet()
  }
  dismissSheet = () => {
    if (!this.state.sheet) return
    this.setState({ sheet: false, sheetLeaving: true, sheetIn: false, sheetDragY: 0, sheetDragging: false })
    this._sheetTo = setTimeout(() => {
      this._sheetTo = null
      this.setState({ sheetLeaving: false, sheetTall: false })
    }, reduceMotion() ? 0 : 340)
  }
  // ── bottom-sheet drag ───────────────────────────────────────────────────────
  // Both sheets grab the same way: drag down dismisses (distance OR a flick),
  // and a touch pull-down on the content does the same once it's scrolled to
  // the top. The only difference is the second detent — the entry sheet can be
  // dragged up to `tall`, the shift sheet has one height, so an up-drag there
  // rubber-bands and snaps back. `keys.tall` null opts out.
  // Built once per sheet in the constructor so the handlers stay referentially
  // stable across renders.
  sheetGestures(keys) {
    const { y, dragging, tall, close } = keys
    const priv = {} // { drag, body } — per-sheet, so two sheets can't cross wires
    const move = e => {
      const d = priv.drag; if (!d) return
      const now = Date.now()
      d.vel = (e.clientY - d.lastY) / Math.max(1, now - d.lastT)
      d.lastY = e.clientY; d.lastT = now
      this.setState({ [y]: e.clientY - d.y0 })
    }
    const end = () => {
      const d = priv.drag; if (!d) return
      priv.drag = null
      const dy = this.state[y], vel = d.vel
      const reset = { [y]: 0, [dragging]: false }
      // leave the drag state alone on dismiss — the sheet holds its dragged spot
      // until the (async) animated close carries it the rest of the way down
      if (dy > 110 || (dy > 30 && vel > 0.55)) return close()
      if (tall) {
        if (dy < -40 || vel < -0.55) return this.setState({ ...reset, [tall]: true })
        if (this.state[tall] && dy > 40) return this.setState({ ...reset, [tall]: false })
      }
      this.setState(reset)
    }
    const grab = e => {
      priv.drag = { y0: e.clientY, lastY: e.clientY, lastT: Date.now(), vel: 0 }
      this.setState({ [dragging]: true })
    }
    return {
      start: e => {
        grab(e)
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* best-effort; drag still tracks */ }
      },
      move,
      end,
      // native-sheet gesture: a touch pull-down on the content works like the
      // handle, but only when the content is scrolled to the top and the touch
      // didn't start on a control (buttons scrub/tap; native scroll keeps pan-y)
      bodyDown: e => {
        if (e.pointerType === 'mouse' || e.target.closest?.('button, input, label')) { priv.body = null; return }
        priv.body = { y0: e.clientY, el: e.currentTarget, active: false }
      },
      bodyMove: e => {
        const b = priv.body; if (!b) return
        if (!b.active) {
          const dy = e.clientY - b.y0
          if (b.el.scrollTop > 0 || dy < -6) { priv.body = null; return }
          if (dy < 10) return
          b.active = true
          try { b.el.setPointerCapture(e.pointerId) } catch { /* drag still tracks */ }
          // re-base at the activation point so the sheet doesn't jump by the slop
          grab(e)
        }
        move(e)
      },
      bodyUp: () => {
        if (priv.body?.active) end()
        priv.body = null
      },
    }
  }
  pick = k => () => this.setState(s => ({ sel: k, detail: s.sel === k ? s.detail : this.defaultDetail(k), detail2: s.sel === k ? s.detail2 : this.defaultDetail2(k) }))
  // ── chip scrub: tap picks the preset, drag up/down dials a custom value ────
  // shared by durations and ounces — `key` picks the ladder the drag walks
  scrubStart = (field, key, base) => e => {
    const ladder = SCRUB[key].ladder
    this._scrub = { field, key, base, y0: e.clientY, moved: false, idx0: ladderIdx(ladder, base) }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* drag still tracks */ }
  }
  scrubMove = e => {
    const d = this._scrub
    if (!d) return
    const dy = d.y0 - e.clientY // up = more, like pulling a value out of the chip
    if (!d.moved && Math.abs(dy) < 7) return
    d.moved = true
    const ladder = SCRUB[d.key].ladder
    const i = Math.max(0, Math.min(ladder.length - 1, d.idx0 + Math.round(dy / 14)))
    const val = ladder[i]
    if (this.state.scrubDrag?.val !== val) this.setState({ scrubDrag: { field: d.field, base: d.base, val } })
  }
  scrubEnd = () => {
    const d = this._scrub
    this._scrub = null
    if (!d) return
    const val = d.moved ? this.state.scrubDrag?.val : null
    if (val != null) this.setState({ [d.field]: val, scrubDrag: null })
    else if (d.field === 'detail2') this.setState(s => ({ detail2: s.detail2 === d.base ? null : d.base, scrubDrag: null })) // tap toggles, as before
    else this.setState({ detail: d.base, scrubDrag: null })
  }
  nudge = n => () => this.setState({ offset: n, pickedT: null, dayPicked: false })
  pickTime = e => {
    const [h, m] = e.target.value.split(':').map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) return
    // the picker speaks start-time. Which day that time falls on: a day the
    // parent chose keeps it; otherwise it's today, and a time that hasn't come
    // round yet means last night (11:50 PM picked shortly after midnight).
    // Reading the day off what the sheet SHOWS was a trap: a 45m nap opened at
    // 12:20am shows 11:35 PM yesterday, so 12:05 AM landed on yesterday
    // 12:05 AM — a full day early, and nowhere near the top of the log
    const d = new Date(this.dayPicked() ? this.shownStamp() : Date.now()); d.setHours(h, m, 0, 0)
    let t = d.getTime()
    if (t > Date.now() + 60000) t -= DAY
    this.setState({ pickedT: t, offset: 0 })
  }
  // ── the day, one tap deeper ────────────────────────────────────────────────
  // Backfilling used to stop at the day boundary: the nudges reach an hour back
  // and the time picker's midnight rule (a time later than now means last
  // night) only ever reaches yesterday. "It's 3am and I never logged the 11pm
  // feed — no, the one before that" is exactly where that runs out, so the day
  // is its own control, behind Advanced because the common path has nothing to
  // say about it.
  setDay = d => {
    // the day carries the time-of-day already on the sheet
    const at = new Date(this.shownStamp())
    at.setFullYear(d.getFullYear(), d.getMonth(), d.getDate())
    // today + a time that hasn't come round yet would log the future; the
    // latest honest answer is now — for a span, a session that ends now
    this.setState({ pickedT: Math.min(at.getTime(), Date.now() - this.stampShift()), offset: 0, dayPicked: true })
  }
  pickDayBack = n => () => { const d = new Date(); d.setDate(d.getDate() - n); this.setDay(d) }
  pickDate = e => {
    const [y, m, d] = e.target.value.split('-').map(Number)
    if (!y || !m || !d) return
    this.setDay(new Date(y, m - 1, d))
  }

  save = () => {
    const key = this.state.sel || this.predict() || 'bottle'
    const at = this.stamp(), detail = this.composeDetail(key)
    // the wire stamp is unchanged; the toast names the time the log now shows,
    // which for a sleep/tummy session is where it started (read before
    // closeSheet clears the scrub the duration lives on)
    const shownAt = at - this.stampShift(key)
    const babyId = this.state.sheetChildId ?? this.selChildId()
    this.closeSheet()
    if (this.state.editId) {
      const id = this.state.editId
      this.setState(s => {
        // remember the pre-edit values so the toast's Undo can put them back
        const prev = s.entries.find(e => e.id === id)
        return {
          entries: s.entries.map(e => e.id === id ? { ...e, type: key, t: at, detail, babyId } : e),
          outbox: [...new Set([...s.outbox, id])],
          toast: t('Entry updated'),
          undoAction: prev ? { kind: 'edit', id, prev: { type: prev.type, t: prev.t, detail: prev.detail, babyId: prev.babyId } } : null,
        }
      }, () => this.flushSoon())
    } else {
      // sheetAuthorId is set only when a timer stop routed us here (pumping
      // needs the amount before it can be logged) — that session's owner keeps it
      const entry = { id: uuid(), type: key, t: at, detail, by: this.state.sheetAuthorId ?? this.state.me?.id, babyId }
      this.setState(s => ({
        screen: 'home',
        entries: [entry, ...s.entries],
        outbox: [...s.outbox, entry.id],
        toast: t('{type} logged · {time}', { type: t(T(key).label), time: this.clock(shownAt) }), undoAction: { kind: 'add', id: entry.id },
      }), () => this.flushSoon())
    }
    this.bumpToast()
  }
  bumpToast() {
    if (this._to) clearTimeout(this._to)
    if (this._toGone) { clearTimeout(this._toGone); this._toGone = null }
    this.setState({ toastLeaving: false })
    // fade out before unmounting; the text stays in state until the fade ends
    this._to = setTimeout(() => {
      this.setState({ toastLeaving: true })
      this._toGone = setTimeout(() => {
        this._toGone = null
        this.setState({ toast: null, undoAction: null, toastLeaving: false })
      }, reduceMotion() ? 0 : 220)
    }, 6000)
  }
  markDeleted(id) {
    this.setState(s => ({
      entries: s.entries.map(e => e.id === id ? { ...e, deleted: true } : e),
      outbox: [...new Set([...s.outbox, id])],
    }), () => this.flushSoon())
  }
  // one-shot undo of the last action only (add → delete it, edit → restore the
  // old values, delete → clear the tombstone). Each path re-queues the id, so
  // the undone write pushes after the original and wins last-write-wins —
  // including a restore against its own already-synced tombstone.
  undo = () => {
    const a = this.state.undoAction
    this.setState({ toast: null, toastLeaving: false, undoAction: null })
    if (!a) return
    if (a.kind === 'add') return this.markDeleted(a.id)
    this.setState(s => ({
      entries: s.entries.map(e => e.id === a.id
        ? (a.kind === 'edit' ? { ...e, type: a.prev.type, t: a.prev.t, detail: a.prev.detail, babyId: a.prev.babyId } : { ...e, deleted: false })
        : e),
      outbox: [...new Set([...s.outbox, a.id])],
    }), () => this.flushSoon())
  }
  edit = id => () => {
    const e = this.state.entries.find(x => x.id === id)
    this._base = startOf(e) // an edit anchors on the start the row showed (see stamp)
    // seed the chip row from the entry so an untouched edit never re-homes it.
    // An entry from another day opens with the day control already out — on
    // that entry it's the field you came for, not an advanced one
    this.mountSheet({ editId: id, sel: e.type, offset: 0, pickedT: null,
      advanced: !!this.state.advancedDefault || dayKey(startOf(e)) !== dayKey(Date.now()),
      sheetChildId: e.babyId ?? this.primaryChildId(), ...this.decompose(e.type, e.detail) })
  }
  remove = () => {
    const id = this.state.editId
    this.closeSheet()
    this.setState({ toast: t('Entry deleted'), undoAction: id ? { kind: 'delete', id } : null })
    if (id) this.markDeleted(id)
    this.bumpToast()
  }

  // History day drill-down: one history entry per dive (paging days doesn't
  // stack more) so the Android back gesture returns to the 7-day overview
  openDay = k => {
    if (!this.state.historyDay && !window.history.state?.blDay) {
      try { window.history.pushState({ blDay: true }, '') } catch { /* history blocked — back just exits */ }
    }
    this.setState({ historyDay: k })
  }
  closeDay = () => {
    // consume our entry so the button and the back gesture stay in step
    if (this.state.historyDay && window.history.state?.blDay) return window.history.back()
    this.setState({ historyDay: null })
  }

  chip(on, tone) {
    return on ? { bg: tone || 'var(--ink)', border: tone || 'var(--ink)', fg: 'var(--bg)' }
              : { bg: 'var(--surface)', border: 'rgba(var(--ink-rgb),0.12)', fg: 'var(--muted)' }
  }
  bars(keys, color) {
    const out = []
    const live = this.live()
    const base = new Date(); base.setHours(0, 0, 0, 0)
    for (let d = 6; d >= 0; d--) {
      const from = base.getTime() - d * DAY
      // same day bucket as the History drill-down these bars tap into
      const n = live.filter(e => keys.includes(e.type) && startOf(e) >= from && startOf(e) < from + DAY).length
      out.push({ n, key: dayKey(from), day: d === 0 ? t('Today') : new Date(from).toLocaleDateString(locale(), { weekday: 'short' }) })
    }
    const max = Math.max(...out.map(o => o.n), 1)
    return out.map((o, i) => ({
      value: o.n, day: o.day, onTap: () => this.openDay(o.key),
      h: Math.max(6, Math.round((o.n / max) * 100)) + '%',
      fill: i === 6 ? color : color.replace('0.075', '0.045'),
    }))
  }

  renderVals() {
    const s = this.state
    const live = this.live()
    const st = T(s.sel || 'bottle')
    const step = Number(this.props.timeStep ?? 5) || 5
    const stampT = s.sheet ? this.stamp() : Date.now()
    // what the sheet PRINTS: a sleep/tummy sheet reads out the session's start,
    // not the wire stamp (its end), so "45m earlier" describes when the nap
    // began — the same top-down reading as the rows it will join
    const shownT = s.sheet ? this.shownStamp() : stampT
    const backMin = s.sheet ? Math.max(0, Math.round((this._base - shownT) / 60000)) : 0
    const dayBack = s.sheet ? this.dayOf(shownT) : '' // '' on today, else 'Yesterday' / '{n} days ago'

    const me = s.me, partner = s.partner, sh = s.serverShift
    const myName = me?.name || t('You')
    const partnerName = partner?.name || t('your partner')
    const initial = n => (n || '?').trim()[0]?.toUpperCase() || '?'
    const iAmOnDuty = !me || !s.onDutyUserId || s.onDutyUserId === me.id

    // ── child switcher (only ever rendered with 2+ non-archived children —
    // a single-child household sees exactly the UI it always has) ──────────────
    const kids = (s.children || []).filter(c => !c.archived)
    const selChild = this.selChild()
    const selId = selChild ? selChild.id : null
    // olive active state, same register as the until/export chips
    const childChip = on => on
      ? { bg: 'rgba(var(--accent-rgb),0.16)', border: OLIVE, fg: 'var(--accent-deep)' }
      : { bg: 'var(--surface)', border: 'rgba(var(--ink-rgb),0.12)', fg: 'var(--muted)' }
    const childPills = kids.length > 1 ? kids.map(c => ({
      id: c.id, label: c.name, on: c.id === selId,
      onTap: () => this.setState({ selectedChildId: c.id }),
      ...childChip(c.id === selId),
    })) : null
    // quick-log sheet chip row: redirect a log without leaving the sheet
    const sheetSelId = s.sheetChildId ?? selId
    const sheetChildren = kids.length > 1 ? kids.map(c => ({
      id: c.id, label: c.name, on: c.id === sheetSelId,
      onTap: () => this.setState({ sheetChildId: c.id }),
      ...childChip(c.id === sheetSelId),
    })) : null

    // a running timer OWNS its card. "Slept · 4h ago" while the baby is asleep
    // right now reads as a stale log, so the card flips to the live session —
    // the stopwatch, when it started, and whose it is — until the timer stops
    // and becomes an entry the card can measure from again. Same child rule as
    // every other view: a null baby_id is the primary child.
    const primId = this.primaryChildId()
    const liveTimerFor = keys => s.activeTimers
      .filter(tm => keys.includes(tm.type) && (selId == null || (tm.baby_id ?? primId) === selId))
      .sort((a, b) => (a.started_at || 0) - (b.started_at || 0))[0]
    const cards = this.widgetKeys().map(k => {
      const c = WIDGETS.find(w => w.key === k)
      const tm = liveTimerFor(c.keys)
      if (tm) {
        const tt = T(tm.type)
        return {
          // present tense, and deliberately NOT the timer card's own label —
          // "Sleeping now" against "Slept" is the whole point of the swap
          label: t(tm.type === 'nurse' ? 'Feeding now' : tm.type === 'sleep' ? 'Sleeping now' : tm.type === 'tummy' ? 'Tummy time now' : 'Pumping now'),
          icon: tt.icon, color: tt.color, live: true,
          elapsed: this.stopwatch(Date.now() - tm.started_at), unit: t('so far'),
          at: t('since {time}', { time: this.clock(tm.started_at) })
            + (me && tm.user_id === me.id ? '' : ' · ' + this.memberName(tm.user_id, partnerName)),
        }
      }
      const e = this.lastOf(c.keys)
      const day = e ? this.dayOf(e.t) : ''
      return { label: t(c.label), icon: c.icon, color: c.color, live: false,
        elapsed: e ? this.elapsed(e.t) : '—', unit: t('ago'),
        at: e ? this.clock(e.t) + (day ? ', ' + lower(day) : '') + ' · ' + t(T(e.type).label) : t('nothing logged yet') }
    })

    const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
    const td = live.filter(e => e.t >= midnight.getTime())
    const oz = td.filter(e => e.type === 'bottle').reduce((a, e) => a + (dSplit(e.detail).n || 0), 0)
    const todaySummary = [
      t('{n} feeds', { n: td.filter(e => FEEDS.includes(e.type)).length }),
      this.amt(oz) + this.unit(),
      this.trackOn('diapers') ? t('{n} diapers', { n: td.filter(e => DIAPERS.includes(e.type)).length }) : null,
    ].filter(Boolean).join(' · ')

    // queued-but-unsynced rows get a dimmed dot until the outbox flushes
    const pendingIds = new Set(s.outbox)
    // 3+ grown-ups: rows carry a small who-logged-it initial chip (a two-person
    // household knows who "the other one" is, so it stays chipless like today)
    const showBy = s.members.length > 2
    const byChipFor = e => {
      const m = showBy ? this.memberById(e.by) : null
      return m ? { initial: initial(m.name), name: m.name, color: this.memberColor(m.id) } : null
    }
    const entryRows = [...live].sort((a, b) => startOf(b) - startOf(a)).slice(0, 12).map(e => ({
      t: startOf(e), time: this.clock(startOf(e)), label: t(T(e.type).label), sub: this.subFor(e),
      icon: T(e.type).icon, color: T(e.type).color, onEdit: this.edit(e.id),
      pending: pendingIds.has(e.id), byChip: byChipFor(e),
    }))
    // running timers woven into the Today list at their start time (timerSpot
    // 'today' or 'both') — a live elapsed sub, and every row carries its
    // one-tap Stop, same rule as the top cards
    const feedTimerRows = (s.timerSpot || 'both') !== 'top' ? s.activeTimers.map(tm => {
      const tt = T(tm.type)
      const mine = !!(s.me && tm.user_id === s.me.id)
      const child = kids.length > 1
        ? ((s.children || []).find(c => c.id === (tm.baby_id ?? this.primaryChildId()))?.name || '')
        : ''
      return {
        timer: true, id: tm.id,
        t: tm.started_at, time: this.clock(tm.started_at), label: t(tt.label),
        sub: this.stopwatch(Date.now() - tm.started_at)
          + (child ? ' · ' + child : '')
          + (mine ? '' : ' · ' + this.memberName(tm.user_id, t('your partner'))),
        icon: tt.icon, color: tt.color,
        onStop: () => this.stopTimer(tm.id),
      }
    }) : []
    const timeline = [...entryRows, ...feedTimerRows].sort((a, b) => b.t - a.t)

    // every day on the device, grouped for the History drill-down
    const fmtDay = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' }) }
    const byDay = new Map()
    for (const e of live) { const k = dayKey(startOf(e)); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e) }
    const daySummary = evs => {
      const feeds = evs.filter(e => FEEDS.includes(e.type))
      const dOz = feeds.reduce((a, e) => a + (e.type === 'bottle' ? dSplit(e.detail).n || 0 : 0), 0)
      const p = [t('{n} feeds', { n: feeds.length })]
      if (dOz) p.push(this.amt(dOz) + ' ' + this.unit())
      const dSl = evs.filter(e => e.type === 'sleep').reduce((a, e) => a + (sleepMins(e.detail) || 0), 0)
      if (this.trackOn('sleep') && dSl) p.push(t('{dur} sleep', { dur: this.dur(dSl) }))
      const dDia = evs.filter(e => DIAPERS.includes(e.type)).length
      if (this.trackOn('diapers') && dDia) p.push(t('{n} diapers', { n: dDia }))
      return p.join(' · ')
    }
    const historyDays = [...byDay.keys()].sort().reverse().map(k => ({
      key: k, label: fmtDay(k), sub: daySummary(byDay.get(k)), onTap: () => this.openDay(k),
    }))
    // day-by-day paging: back to the oldest logged day (gaps included), never
    // past today — paging swaps the day in place, it doesn't stack history
    const dayShift = (k, delta) => { const [y, m, d] = k.split('-').map(Number); return dayKey(new Date(y, m - 1, d + delta).getTime()) }
    const todayKey = dayKey(Date.now())
    const oldestKey = byDay.size ? [...byDay.keys()].sort()[0] : todayKey
    const dayEvs = s.historyDay ? byDay.get(s.historyDay) || [] : []
    const dayView = s.historyDay ? {
      label: fmtDay(s.historyDay), sub: dayEvs.length ? daySummary(dayEvs) : t('nothing logged'),
      rows: [...dayEvs].sort((a, b) => startOf(a) - startOf(b)).map(e => ({
        time: this.clock(startOf(e)), label: t(T(e.type).label), sub: this.subFor(e, true),
        icon: T(e.type).icon, color: T(e.type).color, onEdit: this.edit(e.id),
        pending: pendingIds.has(e.id), byChip: byChipFor(e),
      })),
      prev: s.historyDay > oldestKey ? () => this.setState({ historyDay: dayShift(s.historyDay, -1) }) : null,
      next: s.historyDay < todayKey ? () => this.setState({ historyDay: dayShift(s.historyDay, 1) }) : null,
      back: this.closeDay,
    } : null

    // hidden trackers drop out of the sheet, except while editing an old entry of that type
    const types = TYPES.filter(ty => this.typeOn(ty.key) || ty.key === s.sel).map(ty => {
      const on = ty.key === s.sel
      return { label: t(ty.label), icon: ty.icon, color: ty.color, on, tint: on ? 0.13 : 0.045, onTap: this.pick(ty.key) }
    })

    const nudges = [{ n: 0, label: t('now') }, { n: -step, label: '−' + step }, { n: -step * 3, label: '−' + step * 3 }, { n: -60, label: '−1h' }]
      .map(d => ({ label: d.label, onTap: this.nudge(d.n), ...this.chip(s.pickedT == null && s.offset === d.n, OLIVE) }))

    // the day control behind Advanced: today, yesterday, and the calendar for
    // anything older. Every chip reads the day the sheet is SHOWING, so a nap
    // that started before midnight sits on yesterday even though it woke today
    const dayAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d }
    const shownDay = dayKey(shownT)
    const dayChips = [0, 1].map(n => ({
      label: n ? t('Yesterday') : t('Today'), onTap: this.pickDayBack(n),
      ...this.chip(shownDay === dayKey(dayAgo(n)), OLIVE),
    }))
    const dateChip = {
      label: new Date(shownT).toLocaleDateString(locale(), { month: 'short', day: 'numeric' }),
      ...this.chip(shownDay !== dayKey(dayAgo(0)) && shownDay !== dayKey(dayAgo(1)), OLIVE),
    }

    const kind = st.detail
    // scrubbable chips: few presets, the current custom value sorted in as its
    // own chip, and the chip under a drag showing the live scrubbed value
    const scrubChips = (field, key) => {
      const cur = s[field] != null && !Number.isNaN(Number(s[field])) ? Number(s[field]) : null
      const vals = [...SCRUB[key].presets]
      if (cur != null && !vals.includes(cur)) vals.push(cur)
      vals.sort((a, b) => a - b)
      const drag = s.scrubDrag && s.scrubDrag.field === field ? s.scrubDrag : null
      const fmt = v => key === 'oz' || key === 'ml' ? v + ' ' + this.unit() : this.dur(v)
      return vals.map(dv => {
        const dragging = !!drag && drag.base === dv
        const on = dragging || (!drag && cur === dv)
        return { label: fmt(dragging ? drag.val : dv), scrub: true, on,
          onDown: this.scrubStart(field, key, dv), ...this.chip(on, st.color) }
      })
    }
    const opts = kind === 'side' ? ['Left', 'Right', 'Both'].map(v => ({ v, label: t(v) })) : []
    const detailOptions = kind === 'dur' ? scrubChips('detail', st.key === 'tummy' ? 'mins' : 'dur')
      : kind === 'amount' ? scrubChips('detail', this.amountKey())
      : opts.map(o => ({ label: o.label, onTap: () => this.setState({ detail: o.v }), ...this.chip(s.detail === o.v, st.color) }))
    const kind2 = st.key === 'bottle' ? 'milk' : st.key === 'nurse' || st.key === 'pump' ? 'mins' : st.key === 'sleep' ? 'nap' : null
    const opts2 = kind2 === 'milk' ? [{ v: 'breastmilk', label: t('Breast milk') }, { v: 'formula', label: t('Formula') }]
      : kind2 === 'nap' ? [{ v: 'Nap', label: t('Nap') }, { v: 'Night', label: t('Night') }] : []
    const detail2Options = kind2 === 'mins' ? scrubChips('detail2', 'mins')
      : opts2.map(o => ({ label: o.label, onTap: () => this.setState(x => ({ detail2: x.detail2 === o.v ? null : o.v })), ...this.chip(s.detail2 === o.v, st.color) }))
    const detailStr = (kind === 'amount' ? (s.detail != null ? ' ' + s.detail + ' ' + this.unit() : '') : kind === 'side' ? ' ' + (s.detail ? t(s.detail) : '') : kind === 'dur' ? ' ' + this.dur(s.detail) : '')
      + (s.detail2 != null ? (kind2 === 'milk' ? ' · ' + t(s.detail2 === 'formula' ? 'formula' : 'breast milk') : kind2 === 'nap' ? ' · ' + t(s.detail2) : ' · ' + this.dur(s.detail2)) : '')

    // nursing/pump/sleep/tummy default to the live timer; a manual toggle logs a past session
    const timerType = ['nurse', 'pump', 'sleep', 'tummy'].includes(st.key) && !s.editId
    const timerFirst = timerType && !s.manualDur

    const feed = this.lastOf(FEEDS), dia = this.lastOf(DIAPERS), sleep = this.lastOf(['sleep'])
    const handoffRows = [
      { label: t('Last fed'), value: feed ? t('{x} ago', { x: this.elapsed(feed.t) }) : '—' },
      { label: t('That feed was'), value: feed ? (feed.type === 'bottle' ? t('{amount} bottle', { amount: this.fmtDetail(feed.detail) || feed.detail + ' ' + this.unit() }) : t('nursed, {side}', { side: feed.detail ? this.fmtDetail(feed.detail) || feed.detail : t('either') })) : '—' },
      ...(this.trackOn('diapers') ? [{ label: t('Last diaper'), value: dia ? t('{x} ago', { x: this.elapsed(dia.t) }) + ' · ' + t(dia.type === 'both' ? 'wet + dirty' : dia.type) : '—' }] : []),
      ...(this.trackOn('sleep') ? [{ label: t('Last nap ended'), value: sleep ? t('{x} ago', { x: this.elapsed(sleep.t) }) + ' · ' + this.dur(sleepMins(sleep.detail) || 0) : '—' }] : []),
      { label: t('Today so far'), value: t('{n} feeds', { n: td.filter(e => FEEDS.includes(e.type)).length }) + (this.trackOn('diapers') ? ' / ' + t('{n} diapers', { n: td.filter(e => DIAPERS.includes(e.type)).length }) : '') },
    ]

    const week = live.filter(e => e.t >= midnight.getTime() - 6 * DAY)
    const feedsWk = week.filter(e => FEEDS.includes(e.type))
    const ozWk = week.filter(e => e.type === 'bottle').reduce((a, e) => a + (dSplit(e.detail).n || 0), 0)
    const naps = week.filter(e => e.type === 'sleep')
    // wake window: one sleep's end (t) to the next sleep's start (t − duration)
    const sleepsAsc = [...naps].sort((a, b) => a.t - b.t)
    const wakes = []
    for (let i = 1; i < sleepsAsc.length; i++) {
      const w = (sleepsAsc[i].t - (sleepMins(sleepsAsc[i].detail) || 0) * 60000) - sleepsAsc[i - 1].t
      if (w > 0 && w < 8 * 3600000) wakes.push(w) // longer gaps are overnight or unlogged sleep
    }
    const avgWake = wakes.length ? Math.round(wakes.reduce((a, b) => a + b, 0) / wakes.length / 60000) : 0
    const ageI = this.ageInfo()
    const sorted = feedsWk.map(e => e.t).sort((a, b) => a - b)
    const starts = sessionStarts(sorted)
    const clustered = sorted.length - starts.length // feeds folded into a cluster session
    let gaps = []
    for (let i = 1; i < starts.length; i++) gaps.push((starts[i] - starts[i - 1]) / 60000)
    const avgGap = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0
    const longest = gaps.length ? Math.max(...gaps) : 0
    const stats = [
      { label: t('Feeds / day'), value: (feedsWk.length / 7).toFixed(1), unit: t('avg') },
      { label: t('{unit} / day', { unit: this.unit() }), value: Math.round(this.amt(ozWk / 7)), unit: t('bottles only') },
      ...(this.trackOn('diapers') ? [{ label: t('Diapers / day'), value: (week.filter(e => DIAPERS.includes(e.type)).length / 7).toFixed(1), unit: t('avg') }] : []),
      ...(this.trackOn('sleep') ? [
        { label: t('Sleep logged'), value: this.dur(Math.round(naps.reduce((a, e) => a + (sleepMins(e.detail) || 0), 0) / 7)), unit: t('/ day') },
        { label: t('Wake window'), value: avgWake ? this.dur(avgWake) : '—', unit: t('avg') },
      ] : []),
    ]

    // nudge to switch off a daily-expected tracker that clearly isn't being
    // used — parents only, since acting on it writes household settings
    let trackRec = null
    if (this.isParent() && week.length >= 20) {
      for (const tr of TRACKS) {
        if (!['diapers', 'sleep', 'tummy', 'meds'].includes(tr.key)) continue // baths/pumping are legitimately occasional
        if (!this.trackOn(tr.key) || s.settings.dismissed.includes(tr.key)) continue
        const n = week.filter(e => tr.types.includes(e.type)).length
        if (n / 7 < 0.5) { trackRec = { key: tr.key, label: t(tr.label), n }; break }
      }
    }

    // shift window + plan progress — "someone else" is resolved by id against
    // members now, so a third grown-up's shift or ask renders under their name
    const activeMine = sh && sh.state === 'active' && me && sh.user_id === me.id
    const activeTheirs = !!(me && sh && sh.state === 'active' && sh.user_id !== me.id && this.memberById(sh.user_id))
    const completed = sh && sh.state === 'completed'
    const incomingReq = !!(me && sh && sh.state === 'requested' && sh.requester_id !== me.id && this.memberById(sh.requester_id))
    // holding duty and having a shift open are different things: duty is seeded
    // to the founding account at registration and handed straight back by
    // /shifts/handback, and neither opens a shift. Whoever lands in that gap
    // opens the shift sheet on its "Start your shift" framing (sheetStart), so
    // the plan and the checklist are always one tap away, never missing.
    // my own outstanding ask: /state carries one shift, so a pending request
    // hides an active shift of mine behind it while it's open
    const myAsk = !!(me && sh && sh.state === 'requested' && sh.requester_id === me.id)
    // the humans on the other side of each surface — with two members these
    // all collapse to "the partner", with more they name the right person
    const requesterName = incomingReq ? this.memberName(sh.requester_id, partnerName) : partnerName
    const requesterInitial = incomingReq ? initial(this.memberName(sh.requester_id, partner?.name)) : initial(partner?.name)
    const requesterColor = incomingReq && s.members.length > 2 ? this.memberColor(sh.requester_id) : PARTNER_COLOR
    const shiftOwnerName = sh && sh.user_id != null ? this.memberName(sh.user_id, partnerName) : partnerName
    const shiftOwnerInitial = sh && sh.user_id != null ? initial(this.memberName(sh.user_id, partner?.name)) : initial(partner?.name)
    const shiftOwnerColor = sh && sh.user_id != null && s.members.length > 2 ? this.memberColor(sh.user_id) : PARTNER_COLOR
    const dutyHolder = !iAmOnDuty && s.onDutyUserId != null ? this.memberById(s.onDutyUserId) : null
    const dutyName = dutyHolder?.name || partnerName
    // handing back addresses whoever asked me to cover (stored on the shift)
    const myShiftReqId = activeMine && sh.requester_id && sh.requester_id !== me.id ? sh.requester_id : null
    const hbName = myShiftReqId ? this.memberName(myShiftReqId, partnerName) : partnerName
    const shiftStart = (activeMine || activeTheirs || completed ? sh.started_at : null) || Date.now()
    const shiftEnd = completed ? sh.ended_at : null
    // whether a session counts for the shift still turns on when it ENDED (the
    // wake-up is the bit the person on duty dealt with), but the order and the
    // times printed below are start-based like every other list
    const shiftEntries = live.filter(e => e.t >= shiftStart && (!shiftEnd || e.t <= shiftEnd)).sort((a, b) => startOf(a) - startOf(b))
    const matched = new Set()
    // my plan lives in s.plan (editable, pushed via /shifts/plan); the partner's
    // is read straight off the synced server shift — same rows, just read-only,
    // and every poke-to-pull refresh moves the done states along
    const plan = [...(activeTheirs ? sh.plan || [] : s.plan)].sort((a, b) => a.at - b.at).map(p => {
      const keys = FEEDS.includes(p.type) ? FEEDS : [p.type]
      const hit = shiftEntries.find(e => keys.includes(e.type) && !matched.has(e.id))
      if (hit) matched.add(hit.id)
      return { ...p, hit }
    })
    // plan rows carry an invisible <input type="time"> over their time, the
    // same overlay the log sheet's stamp uses — tap the time, get the native
    // picker, no new chrome
    const hm = at => String(new Date(at).getHours()).padStart(2, '0') + ':' + String(new Date(at).getMinutes()).padStart(2, '0')
    // what a plan can contain: things you schedule. Diapers happen to you.
    const planAdd = scope => ({
      open: s.planAddOpen === scope,
      toggle: () => this.setState(st2 => ({ planAddOpen: st2.planAddOpen === scope ? null : scope })),
      types: ['bottle', 'nurse', 'pump', 'sleep', 'tummy', 'bath', 'meds']
        .filter(k => this.typeOn(k))
        .map(k => ({ key: k, label: t(k === 'bottle' ? 'Feed' : T(k).label), icon: T(k).icon, color: T(k).color, onTap: this.addPlanItem(scope, k) })),
    })
    let nextSeen = false
    const planRows = plan.map(p => {
      const ty = T(p.type), done = !!p.hit, isNext = !done && !nextSeen; if (isNext) nextSeen = true
      const late = !done && p.at < Date.now()
      const mins = Math.round(Math.abs(p.at - Date.now()) / 60000)
      const rel = mins < 60 ? t('{n}m', { n: mins }) : t('{h}h {m}m', { h: Math.floor(mins / 60), m: mins % 60 })
      return {
        label: t(ty.key === 'bottle' ? 'Feed' : ty.label) + ' · ' + this.clock(p.at).replace(':00', ''),
        icon: ty.icon, color: ty.color,
        sub: done ? t('logged {time}', { time: this.clock(startOf(p.hit)) }) + (p.hit.detail && FEEDS.includes(p.hit.type) ? ' · ' + (this.fmtDetail(p.hit.detail) || p.hit.detail) : '') : isNext ? (late ? t('running {rel} late', { rel }) : t('next up')) : t('later'),
        when: done ? t('done') : late ? t('now') : t('in {rel}', { rel }),
        stateIcon: done ? 'check_circle' : isNext ? 'schedule' : 'radio_button_unchecked',
        stateColor: done ? 'var(--accent)' : isNext ? (late ? 'var(--warn)' : 'var(--accent-deep)') : 'var(--dim)',
        textColor: done ? 'var(--soft)' : 'var(--ink)', whenColor: done ? 'var(--soft)' : late ? 'var(--warn)' : 'var(--accent-deep)',
        // a logged item is history — only what's still ahead can be moved or dropped
        editable: !done && activeMine,
        hm: hm(p.at), onTime: this.setPlanTime('live', p.id), onRemove: this.removePlanItem('live', p.id),
      }
    })
    const nextRow = planRows.find(r => r.stateIcon === 'schedule')
    const fmtPlanLabel = p => t(p.type === 'bottle' ? 'Feed' : T(p.type).label)
    const rhythm = this.draftPlan()
    // one source for the incoming card's predicted chips and the accept sheet's
    // toggle rows — the card must preview exactly the plan the sheet opens with
    // (and acceptShift submits): the seeded draft when one exists, else the rhythm
    // an incoming ask now carries the plan its author proposed — that always
    // wins over this device's own prediction, which is the whole point of
    // moving authorship to the person handing off. Asks from an older client
    // (or from before this shipped) carry none, and fall back as before.
    const draftSrc = s.planDraft || rhythm
    const requestPlan = draftSrc.filter(p => !s.planOff.includes(p.id)).map(p => ({ icon: T(p.type).icon, color: T(p.type).color, label: fmtPlanLabel(p) + ' ~' + this.clock(p.at) }))
    const requestPlanRows = draftSrc.map(p => {
      const off = s.planOff.includes(p.id)
      return { icon: T(p.type).icon, color: T(p.type).color, label: fmtPlanLabel(p), time: '~' + this.clock(p.at),
        hm: hm(p.at), onTime: this.setPlanTime('draft', p.id),
        toggleIcon: off ? 'toggle_off' : 'toggle_on', toggleColor: off ? 'var(--dim)' : 'var(--accent)',
        onToggle: () => this.setState(st2 => ({ planOff: off ? st2.planOff.filter(x => x !== p.id) : [...st2.planOff, p.id] })) }
    })
    const t1 = this.clock(rhythm[0].at), t2 = rhythm[1] ? this.clock(rhythm[1].at) : ''
    const sf = shiftEntries.filter(e => FEEDS.includes(e.type)), sd = shiftEntries.filter(e => DIAPERS.includes(e.type)), ss = shiftEntries.filter(e => e.type === 'sleep')
    const sOz = sf.filter(e => e.type === 'bottle').reduce((a, e) => a + (dSplit(e.detail).n || 0), 0)
    const reportRows = [
      { label: t('Feeds'), value: sf.length ? sf.length + ' · ' + sf.map(e => this.clock(e.t)).join(', ') : t('none yet') },
      { label: t('Total from bottles'), value: this.amt(sOz) + ' ' + this.unit() },
      ...(this.trackOn('diapers') ? [{ label: t('Diapers'), value: sd.length ? sd.length + ' · ' + sd.map(e => t(e.type === 'both' ? 'wet + dirty' : e.type)).join(', ') : t('none yet') }] : []),
      ...(this.trackOn('sleep') ? [{ label: t('Sleep logged'), value: ss.length ? this.dur(ss.reduce((a, e) => a + (sleepMins(e.detail) || 0), 0)) : t('none yet') }] : []),
      { label: t('Last thing'), value: shiftEntries.length ? t(T(shiftEntries[shiftEntries.length - 1].type).label) + ' · ' + this.clock(startOf(shiftEntries[shiftEntries.length - 1])) : '—' },
    ]
    const reqMins = sh?.requested_at ? Math.round((Date.now() - sh.requested_at) / 60000) : 0
    // who an ask would go to, and whether they're working for us rather than
    // co-parenting — the only place role changes anything the user reads
    // (through memberById, since the derived `partner` carries no role)
    const askTo = s.askTarget != null ? this.memberById(s.askTarget)
      : (s.members.length > 2 ? null : (partner ? this.memberById(partner.id) || partner : null))
    const askToCarer = !!askTo && askTo.role === 'caregiver'
    const theirShiftLine = completed
      ? t('{name} has been on since {time}', { name: dutyName, time: this.clock(sh.ended_at) })
      : t('{name} has {baby} right now', { name: dutyName, baby: s.babyName || t('the baby') })

    // shiftUp keeps the sheet's content stable while it slides away
    const shiftUp = s.shiftOpen || s.shiftLeaving
    const showReport = shiftUp && completed && sh.id !== s.dismissedShiftId
    const iHandedBack = completed && me && sh.user_id === me.id
    const noteShown = completed ? (sh.handback_note || s.handbackNote) : s.handbackNote

    return {
      onboarding: s.screen === 'onboard', isHome: s.screen === 'home', isHistory: s.screen === 'history',
      isSettings: s.screen === 'settings',
      goSettings: () => {
        try { window.history.pushState({ blSettings: true }, '') } catch { /* back just exits */ }
        this.setState({
          screen: 'settings',
          // seed the editable account fields fresh each visit; abandoned edits don't linger
          acctName: me?.name || '', acctBabyName: s.babyName || '',
          acctOpen: null, acctError: null, acctEmail: '', acctEmailPw: '', acctPwCur: '', acctPwNew: '',
          childEdits: {}, childAddOpen: false, childAddName: '', childAddDob: '', removeConfirmId: null,
          tokensOpen: false, tokenAddOpen: false, tokenName: '', tokenScopes: [], tokenExpiry: 90,
          tokenError: null, newToken: null, revokeTokenArmId: null,
          mqttOpen: false, mqttCfg: null, mqttForm: null, mqttBusy: false, mqttTestResult: null, mqttError: null,
        })
      },
      settingsBack: () => {
        // consume our entry so the button and the back gesture stay in step
        if (window.history.state?.blSettings) return window.history.back()
        // Now is the only door into Settings, so it's the only way back out
        this.setState({ screen: 'home' })
      },
      showTabs: ['home', 'history', 'settings'].includes(s.screen),
      isSplash: s.screen === 'splash', isAuth: s.screen === 'auth', isLogin: s.authMode === 'login', isSignup: s.authMode === 'signup',
      goSplash: () => this.setState({ screen: 'splash', authError: null }),
      goLogin: () => this.setState({ screen: 'auth', authMode: 'login', authError: null }),
      goSignup: () => this.setState({ screen: 'auth', authMode: 'signup', authError: null }),
      authSubmit: this.authSubmit,
      authTitle: t(s.authMode === 'login' ? 'Welcome back' : 'Let’s set up your log'),
      authBody: t(s.authMode === 'login' ? 'Your log is right where you left it — and whatever your partner added since.' : 'One account per grown-up. You’ll invite the other one in a second.'),
      authCta: s.authBusy ? t('One sec…') : t(s.authMode === 'login' ? 'Log in' : 'Create account'),
      authError: s.authError,
      authName: s.authName, setAuthName: e => this.setState({ authName: e.target.value }),
      authInvite: s.authInvite, setAuthInvite: e => this.setState({ authInvite: e.target.value }),
      authEmail: s.authEmail, setAuthEmail: e => this.setState({ authEmail: e.target.value }),
      authPassword: s.authPassword, setAuthPassword: e => this.setState({ authPassword: e.target.value }),
      forgotOpen: s.forgotOpen,
      toggleForgot: () => this.setState(x => ({ forgotOpen: !x.forgotOpen, forgotResult: null, forgotEmail: x.forgotEmail || x.authEmail })),
      forgotEmail: s.forgotEmail, setForgotEmail: e => this.setState({ forgotEmail: e.target.value, forgotResult: null }),
      sendForgot: this.sendForgot, forgotBusy: s.forgotBusy, forgotResult: s.forgotResult,
      forgotCopy: t(s.forgotResult === 'sent' ? 'If that email has a log here, a reset link is on its way — check spam too.'
        : s.forgotResult === 'unconfigured' ? 'This home server can’t send email yet — ask whoever runs it, or reset from the server.'
          : 'No signal — try again in a moment.'),
      isReset: s.screen === 'reset',
      resetEmail: s.resetEmail,
      resetPw: s.resetPw, setResetPw: e => this.setState({ resetPw: e.target.value, resetError: null }),
      submitReset: this.submitReset, resetBusy: s.resetBusy, resetError: s.resetError,
      resetToLogin: () => this.setState({ screen: 'auth', authMode: 'login', authEmail: s.resetEmail, resetToken: null, resetPw: '', authError: null }),
      loginTabBg: s.authMode === 'login' ? 'var(--surface)' : 'transparent', loginTabFg: s.authMode === 'login' ? 'var(--ink)' : 'var(--soft)', loginTabShadow: s.authMode === 'login' ? '0 2px 8px rgba(38,35,29,0.08)' : 'none',
      signupTabBg: s.authMode === 'signup' ? 'var(--surface)' : 'transparent', signupTabFg: s.authMode === 'signup' ? 'var(--ink)' : 'var(--soft)', signupTabShadow: s.authMode === 'signup' ? '0 2px 8px rgba(38,35,29,0.08)' : 'none',
      goHome: () => this.setState({ screen: 'home' }), goHistory: () => this.setState({ screen: 'history', historyDay: null }),
      homeTabBg: s.screen === 'home' ? 'rgba(var(--accent-rgb),0.14)' : 'var(--surface)',
      homeTabFg: s.screen === 'home' ? 'var(--accent-deep)' : 'var(--soft)',
      histTabBg: s.screen === 'history' ? 'rgba(var(--accent-rgb),0.14)' : 'var(--surface)',
      histTabFg: s.screen === 'history' ? 'var(--accent-deep)' : 'var(--soft)',

      nameField: s.nameField, setName: e => this.setState({ nameField: e.target.value }),
      inviteField: s.inviteField, setInvite: e => this.setState({ inviteField: e.target.value }),
      sendInvite: this.sendInvite,
      dobField: s.dobField, setDob: e => this.setState({ dobField: e.target.value }),
      today: new Date().toISOString().slice(0, 10),
      finishOnboard: this.finishOnboard,

      // headers follow the pills; the settings About card edits the primary
      // child (that's what /baby writes), so it names the primary explicitly
      babyName: (selChild && selChild.name) || s.babyName || t('Baby'),
      primaryBabyName: s.babyName || t('Baby'),
      ageLabel: this.ageInfo().label,
      childPills, sheetChildren,
      dateLabel: new Date().toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' }),
      sinceCards: cards, todaySummary, timeline,
      offline: s.offline,

      sheetOpen: s.sheet,
      sheetMounted: s.sheet || s.sheetLeaving, sheetShown: s.sheet && s.sheetIn,
      sheetGrab: this.sheetDrag,
      sheetTranslate: s.sheetDragY > 0 ? s.sheetDragY : (s.sheetTall ? Math.max(s.sheetDragY / 4, -18) : Math.max(s.sheetDragY / 2, -46)),
      sheetDragging: s.sheetDragging, sheetTall: s.sheetTall,
      // a stamp on another day says so up front — "11:40 PM" alone is a trap at
      // 3am, when the day is the thing you're most likely to have wrong
      sheetKicker: s.editId ? t('Editing entry') + (dayBack ? ' · ' + dayBack : '')
        : dayBack || (backMin < 1 ? t('stamped now') : t('{dur} earlier', { dur: this.dur(backMin) })),
      stampTime: this.clock(shownT),
      stampHM: String(new Date(shownT).getHours()).padStart(2, '0') + ':' + String(new Date(shownT).getMinutes()).padStart(2, '0'),
      pickTime: this.pickTime,
      showPicker: e => { try { e.currentTarget.showPicker() } catch { /* older browsers fall back to focus */ } },
      nudges, types,
      // Advanced: hidden on the timer path (a live timer starts now, so there's
      // no day to argue with) and closed unless this opening asked for it
      canAdvanced: !timerFirst, advancedOpen: !timerFirst && s.advanced,
      toggleAdvanced: () => this.setState(x => ({ advanced: !x.advanced })),
      dayChips, dateChip, pickDate: this.pickDate,
      dateValue: shownDay, dateMax: dayKey(Date.now()),
      // what the entry will actually read as, spelled out — a span also shows
      // where it ends, which is the half the sheet never prints
      stampFull: new Date(shownT).toLocaleDateString(locale(), { weekday: 'short', month: 'short', day: 'numeric' })
        + ' · ' + this.clock(shownT) + (stampT > shownT ? ' → ' + this.clock(stampT) : ''),
      hasDetail: !!kind && !timerFirst, detailLabel: t(kind === 'amount' ? 'Amount' : kind === 'side' ? 'Side' : 'Duration'), detailOptions,
      hasDetail2: !!kind2 && !timerFirst, detail2Label: t(kind2 === 'milk' ? 'Milk' : kind2 === 'nap' ? 'Nap or night' : 'Duration'), detail2Options,
      scrubMove: this.scrubMove, scrubEnd: this.scrubEnd,
      showStamp: !timerFirst,
      timerFirst,
      startTimerLabel: t(st.key === 'nurse' ? 'Start nursing' : st.key === 'sleep' ? 'Start sleep timer' : st.key === 'tummy' ? 'Start tummy time' : 'Start pumping'),
      startTimer: () => this.startTimer(st.key),
      canManual: timerType,
      toManual: () => this.setState({ manualDur: true }),
      toTimer: () => this.setState({ manualDur: false }),
      manualHint: t(st.key === 'nurse' ? 'Log a past feed' : st.key === 'sleep' ? 'Log a past sleep' : 'Log a past session'),
      // running-timer cards at the top of Now (timerSpot 'top' or 'both') —
      // one per concurrent timer, in start order so cards stay put as new ones
      // append. With 2+ unarchived children each names its child (null baby_id
      // = primary, same rule as entries). Any card stops in one tap, whoever
      // started it — same as the rows in the Today list.
      timers: ((s.timerSpot || 'both') === 'today' ? [] : s.activeTimers).map(tm => {
        const tt = T(tm.type)
        return {
          id: tm.id,
          label: t(tm.type === 'nurse' ? 'Nursing' : tm.type === 'sleep' ? 'Sleep' : tm.type === 'tummy' ? 'Tummy time' : 'Pumping'),
          child: kids.length > 1
            ? ((s.children || []).find(c => c.id === (tm.baby_id ?? this.primaryChildId()))?.name || '')
            : '',
          icon: tt.icon, color: tt.color,
          elapsed: this.stopwatch(Date.now() - tm.started_at),
          who: tm.user_id === me?.id ? t('You') : this.memberName(tm.user_id, partnerName),
          stop: () => this.stopTimer(tm.id),
        }
      }),
      saveLabel: t(s.editId ? 'Update {thing}' : 'Save {thing}', { thing: lower(t(st.label)) }) + detailStr,
      editing: !!s.editId, toast: !!s.toast, toastText: s.toast || '', toastLeaving: s.toastLeaving, canUndo: !!s.undoAction,
      openSheet: this.openSheet, closeSheet: this.closeSheet, save: this.save, undo: this.undo, remove: this.remove,

      handoffRows,
      hasPartner: !!partner,
      partnerName, myName,
      partnerInitial: initial(partner?.name), myInitial: initial(me?.name),
      requesterName, requesterInitial, requesterColor,
      shiftOwnerName, shiftOwnerInitial, shiftOwnerColor,
      // who I'd relieve / who relieves me — the take-over sheet's counterparty
      relieveName: dutyName,
      relieveInitial: initial(dutyHolder?.name || partner?.name),
      relieveColor: !iAmOnDuty && s.members.length > 2 && s.onDutyUserId != null ? this.memberColor(s.onDutyUserId) : PARTNER_COLOR,
      hbName,
      // opens the compose sheet now — there's a plan to author, not just a note to fire
      askLabel: askTo ? t('Ask {name} to take over', { name: askTo.name }) : t('Ask someone else to take over'),
      // a shift someone handed you is owed back; one you started yourself has
      // nobody to hand it back TO, so asking is the only honest way out of it
      handedToMe: !!myShiftReqId,
      // the one shift surface Now still owns: an ask needs answering, so it
      // can't wait behind a tap. Your shift, their shift, and on-duty-with-
      // nothing-open all moved into the sheet behind the header button.
      incoming: incomingReq && s.screen === 'home',
      theirs: activeTheirs && !iAmOnDuty,
      // the header's shift button. Icon-only, so its accessible name IS the
      // state — which is also where "who has the baby" lives now that the duty
      // avatar is gone. It only shouts — accent fill plus a pulsing dot — when
      // someone is waiting on an answer from you.
      // mirrors what the sheet opens on — with the footer shortcut gone this
      // is the only place the duty state is spelled out, so it can't skip the
      // "someone else has them" case the footer used to cover
      shiftBtnLabel: incomingReq ? t('{name} is handing off', { name: requesterName })
        : activeMine ? t('Your shift') : activeTheirs ? t('{name}’s shift', { name: shiftOwnerName })
          : !iAmOnDuty ? t('Take over from {name}', { name: dutyName })
            : myAsk ? t('Waiting for {name}', { name: partnerName }) : t('Start my shift'),
      shiftBtnBg: incomingReq ? 'rgba(var(--accent-rgb),0.16)' : 'var(--surface)',
      shiftBtnBorder: incomingReq ? OLIVE : 'rgba(var(--ink-rgb),0.08)',
      shiftBtnFg: incomingReq || activeMine ? 'var(--accent-deep)' : 'var(--muted)',
      shiftBtnDot: incomingReq,
      requestAgo: reqMins < 1 ? t('asked just now') : t('asked {n} min ago', { n: reqMins }),
      requestNote: (sh && sh.note) || t('Can you take {name}? Next feeds look like {t1} and {t2} — that’s the usual rhythm.', { name: s.babyName || t('the baby'), t1, t2 }),
      requestPlan, requestPlanRows,
      planAddDraft: planAdd('draft'), planAddLive: planAdd('live'),
      // the stored `until` stays canonical English — untilAt() regex-parses it
      // and the partner's device re-translates it for display
      untilOptions: ['Until she wakes', 'Until 6 AM', 'Open-ended'].map(u => {
        const on = s.until === u
        return { label: t(u), onTap: () => this.setState({ until: u }), ...(on ? { bg: 'rgba(var(--accent-rgb),0.16)', border: OLIVE, fg: 'var(--accent-deep)' } : { bg: 'var(--surface)', border: 'rgba(var(--ink-rgb),0.12)', fg: 'var(--muted)' }) }
      }),
      theirShiftLine,
      shiftMounted: shiftUp, shiftShown: s.shiftOpen && s.shiftIn,
      // same grab as the entry sheet; with no tall detent an up-drag only
      // rubber-bands, so it borrows the short sheet's /2 resistance
      shiftGrab: this.shiftDrag,
      shiftTranslate: s.shiftDragY > 0 ? s.shiftDragY : Math.max(s.shiftDragY / 2, -46),
      shiftDragging: s.shiftDragging,
      // composing an ask — the plan/window/note you're proposing to someone else
      sheetAsk: shiftUp && !showReport && s.shiftMode === 'ask',
      askTitle: askTo ? t('Ask {name} to take over', { name: askTo.name }) : t('Ask someone to take over'),
      // a carer is being told what needs doing; a partner is being asked a favor
      askSub: askToCarer
        ? t('They’ll get the plan and can adjust it if something changes.')
        : t('They can adjust the plan before taking over.'),
      askPlanLabel: askToCarer ? t('What needs to happen') : t('The plan for your shift'),
      askNote: s.askNote,
      setAskNote: e => this.setState({ askNote: e.target.value }),
      askNotePlaceholder: t('e.g. she went down at 11, bottle’s in the fridge'),
      // only worth choosing with three or more grown-ups; two adults have an
      // obvious recipient and shouldn't be made to pick
      askTargets: s.members.length > 2 ? [{ id: null, name: t('Anyone') }, ...s.members.filter(m => m.id !== me?.id)].map(m => {
        const on = (s.askTarget ?? null) === (m.id ?? null)
        return { key: m.id ?? 'any', label: m.name, onTap: () => this.setState({ askTarget: m.id ?? null }),
          ...(on ? { bg: 'rgba(var(--accent-rgb),0.16)', border: OLIVE, fg: 'var(--accent-deep)' } : { bg: 'var(--surface)', border: 'rgba(var(--ink-rgb),0.12)', fg: 'var(--muted)' }) }
      }) : null,
      askCta: askTo ? t('Send to {name}', { name: askTo.name }) : t('Send the ask'),
      openAsk: this.openAsk, sendAsk: this.sendAsk,
      // one "open a shift" sheet, two framings: relieving someone, or starting
      // your own while already holding duty. sheetMine is the running shift.
      sheetStart: shiftUp && !showReport && s.shiftMode !== 'ask' && !activeMine,
      startPair: !iAmOnDuty, // the them→you handoff graphic only reads when duty moves
      startTitle: !iAmOnDuty ? t('Take over from {name}', { name: dutyName })
        : myAsk ? t('Waiting for {name}', { name: partnerName }) : t('Start your shift'),
      startSub: !iAmOnDuty ? theirShiftLine
        : myAsk ? t('Waiting for {name} to take over', { name: partnerName })
          : t('Plan what’s coming so {name} isn’t guessing.', { name: partnerName }),
      startCta: myAsk ? t('Ask again') : iAmOnDuty ? t('Start my shift') : t('I’ve got him — start my shift'),
      startAction: myAsk ? this.requestHandoff : this.acceptShift,
      startFoot: iAmOnDuty
        ? t('{name} sees your plan and how it’s going — without asking.', { name: partnerName })
        : t('{name} gets a “you’re covered” ping and can sleep.', { name: dutyName }),
      sheetMine: shiftUp && !showReport && s.shiftMode !== 'ask' && activeMine,
      sheetReport: showReport,
      reportTitle: iHandedBack ? t('{name}’s back on', { name: dutyName }) : t('{name} handed back', { name: shiftOwnerName }),
      openShift: this.openShift, closeShift: this.closeShift, acceptShift: this.acceptShift, handBack: this.handBack,
      requestHandoff: this.requestHandoff,
      canRequest: iAmOnDuty && !!partner && !(sh && sh.state === 'requested'),
      shiftSince: t('since {time}', { time: this.clock(shiftStart) }), shiftElapsed: this.elapsed(shiftStart),
      nextUp: nextRow ? t('Next: {what} {when}', { what: lower(nextRow.label.split(' · ')[0]), when: nextRow.when }) : t('Plan done'),
      plan: planRows, reportRows,
      reportRange: this.clock(shiftStart) + ' – ' + this.clock(shiftEnd || Date.now()) + ' · ' + t('{dur} on duty', { dur: this.elapsed(shiftStart) }),
      handbackNote: s.handbackNote, reportNote: noteShown, hasHandbackNote: !!noteShown,
      setHandbackNote: e => this.setState({ handbackNote: e.target.value }),

      historySubtitle: t('{summary} logged', { summary: t('{n} feeds', { n: feedsWk.length }) + (this.trackOn('diapers') ? ' · ' + t('{n} diapers', { n: week.filter(e => DIAPERS.includes(e.type)).length }) : '') }),
      historyDays, dayView,
      stats, feedBars: this.bars(FEEDS, 'oklch(0.60 0.075 130)'), diaperBars: this.bars(DIAPERS, 'oklch(0.60 0.075 210)'),
      feedUnitLabel: t('feeds'),
      showDiaperChart: this.trackOn('diapers'),
      patternTitle: avgGap ? t('Roughly every {dur} between feeds', { dur: this.dur(avgGap) }) : t('Patterns show up after a few feeds'),
      patternBody: avgGap
        ? t('Longest stretch this week was {dur}.', { dur: this.dur(Math.round(longest)) })
          + (clustered ? ' ' + t('Cluster feeds ({n} within 45m of the one before) count as one feed here, so they don’t drag the average down.', { n: clustered }) : '')
          + (ageI.weeks != null ? ' ' + t('Typical at {age}: {norm}.', { age: ageI.label, norm: t(normFor(FEED_NORMS, ageI.weeks)) }) : '')
        : t('Keep logging — once there’s a rhythm, it shows up here.'),
      wakeInsight: this.trackOn('sleep') && avgWake ? {
        title: t('Awake about {dur} between naps', { dur: this.dur(avgWake) }),
        body: ageI.weeks != null
          ? t('Typical at {age} is {norm}. Watching this stretch out over the weeks is the rhythm maturing — not something to fight.', { age: ageI.label, norm: t(normFor(WAKE_NORMS, ageI.weeks)) })
          : t('Add {name}’s birthday below and this compares against what’s typical for their age.', { name: s.babyName || t('the baby') }),
      } : null,
      trackRec: trackRec ? {
        title: t('Not tracking {thing}?', { thing: lower(trackRec.label) }),
        body: (trackRec.n ? t('Only {n} logged', { n: trackRec.n }) : t('Nothing logged')) + ' ' + t('in the last 7 days. Turning it off hides its cards and charts — nothing is deleted, and it comes back if you switch it on again.'),
        offLabel: t('Turn off {thing}', { thing: lower(trackRec.label) }),
        turnOff: () => this.setTracking(trackRec.key, false),
        keep: () => this.dismissRec(trackRec.key),
      } : null,
      birthdate: s.babyBirthdate || '', setBirthdate: this.setBirthdate,
      // the settings card is about the primary child, so its age line is too
      ageLine: s.babyBirthdate ? t('{age} old', { age: this.ageInfoFor(s.babyBirthdate, s.age).label }) : t('Set it and the log thinks in their weeks — insights compare against their age.'),
      notify: (() => {
        const np = this.nPrefs()
        const row = (key, label, icon, color) => ({
          key, label, icon, color, on: !!np[key],
          toggleIcon: np[key] ? 'toggle_on' : 'toggle_off', toggleColor: np[key] ? 'var(--accent)' : 'var(--dim)',
          onToggle: () => this.setNotify({ [key]: !np[key] }),
        })
        return {
          supported: pushSupported(),
          pushOn: s.pushOn,
          togglePush: this.togglePush,
          pushHint: !pushSupported()
            ? t('This browser can’t do push — on iPhone, add mybabynotes to the Home Screen first, then look here again.')
            : t(s.pushOn ? 'This phone gets pings. Pick what’s worth one below — each grown-up sets their own.'
            : 'Flip it on and allow the permission — then pick what’s worth a ping.'),
          rows: [
            row('handoff', t('Handoff asks & handbacks'), 'swap_horiz', 'var(--accent)'),
            ...(partner ? [row('timer', t('{name} starts a timer', { name: s.members.length > 2 ? t('Someone') : partnerName }), 'timer', 'oklch(0.60 0.075 350)')] : []),
            ...(partner ? [row('partner', t('{name} logs something', { name: s.members.length > 2 ? t('Someone') : partnerName }), 'edit_note', 'oklch(0.60 0.075 300)')] : []),
            row('feed', t('Feed reminder'), 'local_drink', 'oklch(0.60 0.075 250)'),
            ...(this.trackOn('sleep') ? [row('wake', t('Wake window watch'), 'wb_twilight', 'oklch(0.60 0.075 25)')] : []),
            ...(this.trackOn('meds') ? [row('meds', t('Daily meds nudge'), 'medication', 'oklch(0.60 0.075 150)')] : []),
            row('quiet', t('Quiet hours'), 'do_not_disturb_on', 'oklch(0.60 0.075 210)'),
          ],
          feedOn: np.feed,
          feedChips: [[null, t('Rhythm')], [120, '2h'], [150, '2½h'], [180, '3h'], [210, '3½h'], [240, '4h']
          ].map(([v2, label]) => ({ label, onTap: () => this.setNotify({ feedEvery: v2 }), ...this.chip(np.feedEvery === v2, OLIVE) })),
          // 2+ children: one labeled chip row per child writing feedEveryByChild;
          // "Rhythm" clears that child's override so it inherits the global
          // feedEvery (untouched by these rows) or the learned rhythm
          feedChildRows: kids.length > 1 ? kids.map(c => {
            const byChild = np.feedEveryByChild || {}
            const cur = byChild[c.id] ?? null
            return {
              id: c.id, name: c.name,
              chips: [[null, t('Rhythm')], [120, '2h'], [150, '2½h'], [180, '3h'], [210, '3½h'], [240, '4h']
              ].map(([v2, label]) => ({
                label,
                onTap: () => {
                  const next = { ...byChild }
                  if (v2 == null) delete next[c.id]; else next[c.id] = v2
                  this.setNotify({ feedEveryByChild: next })
                },
                ...this.chip(cur === v2, OLIVE),
              })),
            }
          }) : null,
          onDutyOnly: np.onDutyOnly,
          onDutyToggleIcon: np.onDutyOnly ? 'toggle_on' : 'toggle_off',
          onDutyToggleColor: np.onDutyOnly ? 'var(--accent)' : 'var(--dim)',
          toggleOnDuty: () => this.setNotify({ onDutyOnly: !np.onDutyOnly }),
          medsOn: np.meds, medsTime: np.medsTime,
          setMedsTime: e => e.target.value && this.setNotify({ medsTime: e.target.value }),
          quietOn: np.quiet, quietStart: np.quietStart, quietEnd: np.quietEnd,
          setQuietStart: e => e.target.value && this.setNotify({ quietStart: e.target.value }),
          setQuietEnd: e => e.target.value && this.setNotify({ quietEnd: e.target.value }),
        }
      })(),
      unitChips: ['oz', 'ml'].map(u => ({
        key: u, label: u, on: this.unit() === u, onTap: () => this.setUnit(u),
      })),
      unitWord: t(this.unit() === 'ml' ? 'millilitres' : 'ounces'),
      trackRows: TRACKS.map(tr => {
        const on = this.trackOn(tr.key), tt = T(tr.types[0])
        return { key: tr.key, on, label: t(tr.label), icon: tt.icon, color: tt.color,
          toggleIcon: on ? 'toggle_on' : 'toggle_off', toggleColor: on ? 'var(--accent)' : 'var(--dim)',
          onToggle: () => this.setTracking(tr.key, !on) }
      }),
      medNameField: s.settings.medName ?? '', setMedName: this.setMedName,
      widgetRows: (() => {
        const shown = this.widgetKeys()
        return WIDGETS.filter(w => !w.track || this.trackOn(w.track)).map(w => {
          const on = shown.includes(w.key)
          return { label: t(w.label), icon: w.icon, color: w.color,
            toggleIcon: on ? 'toggle_on' : 'toggle_off', toggleColor: on ? 'var(--accent)' : 'var(--dim)',
            onToggle: () => this.setWidget(w.key, !on) }
        })
      })(),
      appearance: {
        accents: Object.entries(THEME_ACCENTS).map(([key, a]) => ({
          key, label: a.label, color: a.accent,
          on: (s.settings.theme?.accent || 'peach') === key,
          onTap: () => this.setTheme({ accent: key }),
        })),
        bgs: Object.entries(THEME_BGS).map(([key, b]) => ({
          key, label: b.label, color: b.bg,
          on: (s.settings.theme?.bg || 'cream') === key,
          onTap: () => this.setTheme({ bg: key }),
        })),
        modes: [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([key, label]) => ({
          key, label: t(label), on: (s.fx.mode || 'auto') === key, onTap: () => this.setFxMode(key),
        })),
        tilt: { on: !!s.fx.tilt, onToggle: this.toggleTilt },
        // device-local like theme/tilt: where running timers appear — the
        // one-tap-stop cards up top, rows in the Today list, or both
        timerSpots: [['top', 'Top'], ['today', 'Today'], ['both', 'Both']].map(([key, label]) => ({
          key, label: t(label), on: (s.timerSpot || 'both') === key, onTap: () => this.setState({ timerSpot: key }),
        })),
        // device-local too: whether the log sheet's Advanced drawer starts open.
        // Off by default — most logs are "now", and the drawer costs a tap only
        // on the nights it's the answer. On for whoever backfills often enough
        // that the tap is the annoyance.
        advancedLog: { on: !!s.advancedDefault, onToggle: () => this.setState(x => ({ advancedDefault: !x.advancedDefault })) },
        // device-local like theme mode — the night shift reading Spanish
        // shouldn't flip the partner's phone; setLang re-renders once the
        // catalog chunk lands
        lang: getLang(),
        langs: LANGS,
        // re-subscribing pushes the new language to the server right away, so
        // the next lock-screen ping arrives in it too
        setLang: e => setLang(e.target.value).then(() => { this.setState(x => ({ tick: x.tick + 1 })); this.refreshPush() }),
      },
      exportLog: this.exportLog, exportSummary: this.exportSummary,
      importBB: e => this.importBabyBuddy(e.currentTarget), importBusy: s.importBusy,
      exportRanges: [[7, '7 days'], [30, '30 days'], ['all', 'Everything']].map(([val, label]) => {
        const on = s.exportRange === val
        return { label: t(label), onTap: () => this.setState({ exportRange: val }), ...(on ? { bg: 'rgba(var(--accent-rgb),0.16)', border: OLIVE, fg: 'var(--accent-deep)' } : { bg: 'var(--surface)', border: 'rgba(var(--ink-rgb),0.12)', fg: 'var(--muted)' }) }
      }),
      // ── management surfaces (settings) ─────────────────────────────────────
      canManage: this.isParent(),
      inviteRoleChips: [['parent', 'Parent'], ['caregiver', 'Caregiver']].map(([key, label]) => {
        const on = s.inviteRole === key
        return { key, label: t(label), onTap: () => this.setState({ inviteRole: key }), ...(on ? { bg: 'rgba(var(--accent-rgb),0.16)', border: OLIVE, fg: 'var(--accent-deep)' } : { bg: 'var(--surface)', border: 'rgba(var(--ink-rgb),0.12)', fg: 'var(--muted)' }) }
      }),
      childrenCard: (() => {
        const all = s.children
        if (!all.length) return null // pre-sync cache — the legacy About card still renders
        const canEdit = this.isParent()
        return {
          header: all.length > 1 ? t('Children') : t('About {name}', { name: all[0].name || t('Baby') }),
          canEdit,
          canAdd: canEdit && all.length < this.maxChildren(), // server cap from /state limits
          rows: all.map((c, i) => ({
            id: c.id, primary: i === 0, archived: !!c.archived,
            name: s.childEdits[c.id] ?? c.name ?? '',
            plainName: c.name || t('Baby'),
            birthdate: c.birthdate || '',
            ageText: c.birthdate ? t('{age} old', { age: this.ageInfoFor(c.birthdate, c.age).label }) : (c.age || '—'),
            setName: e => this.setChildEdit(c.id, e.target.value),
            saveName: () => this.saveChildName(c.id),
            setDob: this.setChildDob(c.id),
            onArchive: () => this.toggleChildArchived(c.id),
          })),
          addOpen: s.childAddOpen,
          toggleAdd: () => this.setState(x => ({ childAddOpen: !x.childAddOpen, childAddName: '', childAddDob: '' })),
          addName: s.childAddName, setAddName: e => this.setState({ childAddName: e.target.value }),
          addDob: s.childAddDob, setAddDob: e => this.setState({ childAddDob: e.target.value }),
          submitAdd: this.addChild, addBusy: s.childBusy,
          hint: !canEdit ? t('Only a parent can edit the children.')
            : all.length > 1 ? t('The pills on Now and History switch between children. Hiding one tucks it out of the pills — nothing about their log is deleted.')
            : (s.babyBirthdate ? t('{age} old', { age: this.ageInfoFor(s.babyBirthdate, s.age).label }) : t('Set it and the log thinks in their weeks — insights compare against their age.')),
        }
      })(),
      household: (() => {
        const canManage = this.isParent()
        // pre-sync caches only know me + partner — both grown-ups, both parents
        const mem = s.members.length ? s.members : [
          ...(me ? [{ id: me.id, name: me.name, role: me.role || 'parent' }] : []),
          ...(partner ? [{ id: partner.id, name: partner.name, role: 'parent' }] : []),
        ]
        const seats = mem.length + s.invites.length
        return {
          members: mem.map((m, i) => ({
            id: m.id,
            name: m.name || t('Member'),
            isMe: !!(me && m.id === me.id),
            initial: initial(m.name),
            color: MEMBER_COLORS[i % MEMBER_COLORS.length],
            roleLabel: t(m.role === 'caregiver' ? 'Caregiver' : 'Parent'),
            roleParent: m.role !== 'caregiver',
            canRemove: canManage && !!me && m.id !== me.id,
            armed: s.removeConfirmId === m.id,
            arm: () => this.setState({ removeConfirmId: m.id }),
            disarm: () => this.setState({ removeConfirmId: null }),
            remove: () => this.removeMember(m.id),
          })),
          invites: s.invites.map(i => ({
            email: i.email,
            roleLabel: t(i.role === 'caregiver' ? 'Caregiver' : 'Parent'),
            roleParent: i.role !== 'caregiver',
            // the code is shown once, to the phone that made the invite
            code: s.inviteCode && s.inviteCodeFor === i.email ? s.inviteCode : null,
            copyCode: () => this.copyInviteCode(s.inviteCode),
            // resend = re-invite: the fresh code lands on this phone and kills the old one
            resend: canManage ? () => this.sendInviteTo(i.email, i.role) : null,
            revoke: canManage ? () => this.revokeInvite(i.email) : null,
          })),
          canInvite: canManage && seats < this.maxMembers(),
          full: canManage && seats >= this.maxMembers(),
          capWord: t(spellCount(this.maxMembers())),
          hint: canManage
            ? t('Up to {n} grown-ups share one log. Parents can change anything here; caregivers log, run timers, and cover shifts.', { n: t(spellCount(this.maxMembers())) })
            : t('Only a parent can invite or remove people. You can log, run timers, and cover shifts.'),
        }
      })(),
      account: {
        babyName: s.acctBabyName, setBabyName: e => this.setState({ acctBabyName: e.target.value }),
        saveBabyName: this.saveBabyName,
        name: s.acctName, setName: e => this.setState({ acctName: e.target.value }),
        saveName: this.saveMyName,
        email: me?.email || '',
        open: s.acctOpen, toggle: this.toggleAcct,
        emailField: s.acctEmail, setEmailField: e => this.setState({ acctEmail: e.target.value, acctError: null }),
        emailPw: s.acctEmailPw, setEmailPw: e => this.setState({ acctEmailPw: e.target.value, acctError: null }),
        submitEmail: this.submitAcctEmail,
        pwCur: s.acctPwCur, setPwCur: e => this.setState({ acctPwCur: e.target.value, acctError: null }),
        pwNew: s.acctPwNew, setPwNew: e => this.setState({ acctPwNew: e.target.value, acctError: null }),
        submitPassword: this.submitAcctPassword,
        busy: s.acctBusy, error: s.acctError,
      },
      apiAccess: (() => {
        const chip = on => on ? { bg: 'rgba(var(--accent-rgb),0.16)', border: OLIVE, fg: 'var(--accent-deep)' } : { bg: 'var(--surface)', border: 'rgba(var(--ink-rgb),0.12)', fg: 'var(--muted)' }
        const day = iso => new Date(iso).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' })
        return {
          open: s.tokensOpen, toggle: this.toggleTokens,
          loaded: s.apiTokens != null,
          rows: (s.apiTokens || []).map(tok => ({
            id: tok.id, name: tok.name,
            scopeText: (tok.abilities || []).join(' · '),
            hint: [
              tok.lastUsedAt ? t('last used {x} ago', { x: this.elapsed(new Date(tok.lastUsedAt).getTime()) }) : t('never used'),
              tok.expiresAt ? t('expires {date}', { date: day(tok.expiresAt) }) : t('never expires'),
            ].join(' · '),
            armed: s.revokeTokenArmId === tok.id,
            arm: () => this.setState({ revokeTokenArmId: tok.id }),
            disarm: () => this.setState({ revokeTokenArmId: null }),
            revoke: () => this.revokeApiToken(tok.id),
          })),
          addOpen: s.tokenAddOpen,
          toggleAdd: () => this.setState(x => ({ tokenAddOpen: !x.tokenAddOpen, tokenName: '', tokenScopes: [], tokenExpiry: 90, tokenError: null })),
          name: s.tokenName, setName: e => this.setState({ tokenName: e.target.value, tokenError: null }),
          scopeChips: Object.entries(s.apiScopes || {}).map(([key, label]) => {
            const on = s.tokenScopes.includes(key)
            return { key, label, onTap: () => this.setState(x => ({ tokenScopes: on ? x.tokenScopes.filter(k => k !== key) : [...x.tokenScopes, key], tokenError: null })), ...chip(on) }
          }),
          expiryChips: [[30, '30 days'], [90, '90 days'], [365, '1 year'], [null, 'No expiry']].map(([val, label]) => ({
            key: String(val), label: t(label), onTap: () => this.setState({ tokenExpiry: val }), ...chip(s.tokenExpiry === val),
          })),
          submit: this.createApiToken, busy: s.tokenBusy, error: s.tokenError,
          canCreate: !!s.tokenName.trim() && s.tokenScopes.length > 0 && !s.tokenBusy,
          newToken: s.newToken, copyNew: this.copyApiToken,
        }
      })(),
      mqtt: (() => {
        const cfg = s.mqttCfg, f = s.mqttForm
        const beat = cfg?.heartbeatAt ? new Date(cfg.heartbeatAt).getTime() : null
        const fresh = beat != null && Date.now() - beat < 5 * 60000
        return {
          open: s.mqttOpen, toggle: this.toggleMqtt,
          loaded: cfg != null && f != null,
          hint: cfg == null ? t('Sync sensors to your smart home')
            : !cfg.enabled ? t('Off')
              : fresh ? t('On · synced {x} ago', { x: this.elapsed(beat) })
                : t('On · broker unreachable'),
          enabled: !!f?.enabled, toggleEnabled: () => this.setMqttForm({ enabled: !f.enabled }),
          host: f?.host ?? '', setHost: e => this.setMqttForm({ host: e.target.value }),
          port: f?.port ?? '', setPort: e => this.setMqttForm({ port: e.target.value === '' ? '' : Number(e.target.value) }),
          username: f?.username ?? '', setUsername: e => this.setMqttForm({ username: e.target.value }),
          password: f?.password ?? '', setPassword: e => this.setMqttForm({ password: e.target.value }),
          pwPlaceholder: cfg?.hasPassword ? t('•••• saved') : t('Password'),
          tls: !!f?.tls, toggleTls: () => this.setMqttForm({ tls: !f.tls }),
          tlsVerify: f?.tls_verify !== false, toggleTlsVerify: () => this.setMqttForm({ tls_verify: !f.tls_verify }),
          test: this.testMqtt, save: this.saveMqtt,
          busy: s.mqttBusy, testResult: s.mqttTestResult, error: s.mqttError,
        }
      })(),
      logout: () => this.doLogout(true),
      invitePending: s.invitePending, inviteCode: s.inviteCode, inviteMailed: s.inviteMailed,
    }
  }

  render() {
    const v = this.renderVals()
    return (
      <div className="app">
        {/* background illustration + wash; .fx-* layers drift on --par-x/--par-y
            from fx.js — each layer's negative inset covers its travel distance */}
        <div style={S('position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden')}>
          <div className="fx-layer fx-far" style={S('position:absolute;inset:-14px')}>
            <img className="bg-art" src={appBgArt} alt="" style={S('width:100%;height:100%;object-fit:cover;display:block')} />
          </div>
          <div className="fx-layer fx-mid" style={S('position:absolute;inset:-24px')}>
            <div style={S('position:absolute;top:-8%;right:-16%;width:66%;aspect-ratio:1;border-radius:999px;background:radial-gradient(circle, rgba(var(--accent-rgb),0.16), rgba(var(--accent-rgb),0) 70%)')} />
            <div style={S('position:absolute;bottom:14%;left:-18%;width:58%;aspect-ratio:1;border-radius:999px;background:radial-gradient(circle, rgba(var(--accent-rgb),0.12), rgba(var(--accent-rgb),0) 70%)')} />
          </div>
          <div className="bg-wash" style={S('position:absolute;inset:0;background:linear-gradient(to bottom, rgba(250,246,239,0.25), rgba(250,246,239,0.6) 45%, rgba(250,246,239,0.85))')} />
          <div className="fx-layer fx-near" style={S('position:absolute;inset:-36px')}>
            <div style={S('position:absolute;top:22%;left:-12%;width:40%;aspect-ratio:1;border-radius:999px;background:radial-gradient(circle, rgba(var(--accent-rgb),0.10), rgba(var(--accent-rgb),0) 70%)')} />
          </div>
        </div>

        {v.isSplash && (
          <div style={S('flex:1;display:flex;flex-direction:column;align-items:center;padding:0 24px 22px;position:relative;z-index:1;min-height:0')}>
            <div style={S('flex:1')} />
            <div style={S('width:168px;height:168px;border-radius:999px;background:#FFFDF8;box-shadow:0 14px 40px rgba(38,35,29,0.12);display:flex;align-items:center;justify-content:center')}>
              <Logo size={116} />
            </div>
            <div style={S("font-family:'Nunito',sans-serif;font-weight:800;font-size:40px;letter-spacing:-0.03em;padding-top:26px")}><Wordmark /></div>
            <div style={S('font-size:16.5px;line-height:1.45;color:#6E6659;text-align:center;padding-top:8px;text-wrap:pretty;max-width:260px')}>{t('Three taps, then back to the baby.')}<br />{t('Both of you, one log.')}</div>
            <div style={S('flex:1.2')} />
            <button type="button" onClick={v.goSignup} className="hov-olive" style={S('width:100%;height:60px;background:var(--accent);border:none;border-radius:999px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-family:inherit;box-shadow:0 8px 20px rgba(var(--accent-rgb),0.3)')}>
              <div style={S('font-size:17px;font-weight:700;color:#FCFBF6')}>{t('Create an account')}</div>
            </button>
            <button type="button" onClick={v.goLogin} className="hov-cream" style={S('margin-top:10px;width:100%;height:56px;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-family:inherit')}>
              <div style={S('font-size:16px;font-weight:600;color:#4E4A3F')}>{t('I already have one')}</div>
            </button>
            <div style={S('font-size:12px;color:#B5AC98;padding-top:16px')}>{t('Works on iPhone and Android · add to home screen')}</div>
          </div>
        )}

        {v.isAuth && (
          <div style={S('flex:1;display:flex;flex-direction:column;padding:8px 24px 20px;overflow:auto;position:relative;z-index:1;min-height:0')}>
            <div style={S('display:flex;align-items:center;justify-content:space-between')}>
              <button type="button" onClick={v.goSplash} className="hov-cream" style={S('width:38px;height:38px;border-radius:999px;background:#FFFDF8;border:1px solid rgba(38,35,29,0.10);display:flex;align-items:center;justify-content:center;cursor:pointer')}>
                <Sym style={{ fontSize: 20, color: 'var(--muted)' }}>arrow_back</Sym>
              </button>
              <div style={S('display:flex;align-items:center;gap:6px')}>
                <Logo size={30} />
                <div style={S("font-family:'Nunito',sans-serif;font-weight:800;font-size:17px;letter-spacing:-0.02em")}><Wordmark /></div>
              </div>
              <div style={S('width:38px')} />
            </div>
            <div style={S('display:flex;background:rgba(38,35,29,0.06);border-radius:999px;padding:4px;margin-top:26px')}>
              <button type="button" onClick={v.goLogin} style={S(`flex:1;height:40px;border:none;border-radius:999px;background:${v.loginTabBg};color:${v.loginTabFg};font-family:inherit;font-size:14.5px;font-weight:700;cursor:pointer;box-shadow:${v.loginTabShadow}`)}>{t('Log in')}</button>
              <button type="button" onClick={v.goSignup} style={S(`flex:1;height:40px;border:none;border-radius:999px;background:${v.signupTabBg};color:${v.signupTabFg};font-family:inherit;font-size:14.5px;font-weight:700;cursor:pointer;box-shadow:${v.signupTabShadow}`)}>{t('Sign up')}</button>
            </div>
            <div style={S("font-family:'Nunito',sans-serif;font-weight:800;font-size:28px;line-height:1.12;letter-spacing:-0.02em;padding-top:26px;text-wrap:pretty")}>{v.authTitle}</div>
            <div style={S('font-size:14.5px;line-height:1.5;color:#6E6659;padding-top:6px;text-wrap:pretty')}>{v.authBody}</div>
            <div style={S('display:flex;flex-direction:column;gap:10px;padding-top:22px')}>
              {v.isSignup && (
                <input placeholder={t('Your name')} value={v.authName} onChange={v.setAuthName} style={S('width:100%;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:18px;padding:15px 18px;font-size:16.5px;color:#26231D;outline:none')} />
              )}
              <input placeholder={t('Email')} type="email" value={v.authEmail} onChange={v.setAuthEmail} style={S('width:100%;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:18px;padding:15px 18px;font-size:16.5px;color:#26231D;outline:none')} />
              <input placeholder={t('Password')} type="password" value={v.authPassword} onChange={v.setAuthPassword} style={S('width:100%;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:18px;padding:15px 18px;font-size:16.5px;color:#26231D;outline:none')} />
              {v.isSignup && (
                <input placeholder={t('Invite code — only if a partner invited you')} value={v.authInvite} onChange={v.setAuthInvite} style={S('width:100%;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:18px;padding:15px 18px;font-size:16.5px;color:#26231D;outline:none')} />
              )}
            </div>
            {v.isLogin && (
              <div style={S('display:flex;justify-content:flex-end;padding-top:10px')}><a href="#" onClick={e => { e.preventDefault(); v.toggleForgot() }} style={S('font-size:13.5px;font-weight:600;color:#5F6E42')}>{t('Forgot password?')}</a></div>
            )}
            {v.isLogin && v.forgotOpen && (
              <div style={S('margin-top:10px;background:#FFFDF8;border:1px solid rgba(38,35,29,0.10);border-radius:24px;padding:16px 18px')}>
                <div style={S('font-size:13.5px;font-weight:700;color:#26231D')}>{t('Reset your password')}</div>
                <div style={S('font-size:12.5px;line-height:1.5;color:#8C8474;padding-top:4px;text-wrap:pretty')}>{t('We’ll email you a link to set a new one.')}</div>
                <div style={S('display:flex;gap:8px;padding-top:10px')}>
                  <input placeholder={t('Email')} type="email" value={v.forgotEmail} onChange={v.setForgotEmail} style={S('flex:1;min-width:0;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;padding:11px 16px;font-size:14.5px;color:#26231D;outline:none')} />
                  <button type="button" onClick={v.sendForgot} className="hov-olive" style={S('height:42px;padding:0 18px;background:var(--accent);border:none;border-radius:999px;cursor:pointer;font-family:inherit;font-size:13.5px;font-weight:700;color:#FCFBF6;flex-shrink:0')}>{v.forgotBusy ? t('One sec…') : t('Send')}</button>
                </div>
                {v.forgotResult && (
                  <div style={S(`font-size:12.5px;line-height:1.5;padding-top:10px;text-wrap:pretty;color:${v.forgotResult === 'error' ? '#A85A45' : '#6E6659'}`)}>{v.forgotCopy}</div>
                )}
              </div>
            )}
            {v.authError && (
              <div style={S('font-size:13px;line-height:1.4;color:#A85A45;padding-top:12px;text-wrap:pretty')}>{v.authError}</div>
            )}
            <button type="button" onClick={v.authSubmit} className="hov-olive" style={S('margin-top:18px;width:100%;height:60px;background:var(--accent);border:none;border-radius:999px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;font-family:inherit;box-shadow:0 8px 20px rgba(var(--accent-rgb),0.3)')}>
              <div style={S('font-size:17px;font-weight:700;color:#FCFBF6')}>{v.authCta}</div>
              <Sym style={{ fontSize: 21, color: 'var(--on-accent)' }}>arrow_forward</Sym>
            </button>
            <div style={S('flex:1')} />
            <div style={S('font-size:12px;line-height:1.5;color:#B5AC98;text-align:center;padding-top:16px;text-wrap:pretty')}>{t('Invited by a partner? Use the same email they sent it to and you’ll land in their log.')}</div>
          </div>
        )}

        {v.isReset && (
          <div style={S('flex:1;display:flex;flex-direction:column;padding:8px 24px 20px;overflow:auto;position:relative;z-index:1;min-height:0')}>
            <div style={S('display:flex;align-items:center;justify-content:space-between')}>
              <button type="button" onClick={v.resetToLogin} className="hov-cream" style={S('width:38px;height:38px;border-radius:999px;background:#FFFDF8;border:1px solid rgba(38,35,29,0.10);display:flex;align-items:center;justify-content:center;cursor:pointer')}>
                <Sym style={{ fontSize: 20, color: 'var(--muted)' }}>arrow_back</Sym>
              </button>
              <div style={S('display:flex;align-items:center;gap:6px')}>
                <Logo size={30} />
                <div style={S("font-family:'Nunito',sans-serif;font-weight:800;font-size:17px;letter-spacing:-0.02em")}><Wordmark /></div>
              </div>
              <div style={S('width:38px')} />
            </div>
            <div style={S("font-family:'Nunito',sans-serif;font-weight:800;font-size:28px;line-height:1.12;letter-spacing:-0.02em;padding-top:26px;text-wrap:pretty")}>{t('Set a new password')}</div>
            <div style={S('font-size:14.5px;line-height:1.5;color:#6E6659;padding-top:6px;text-wrap:pretty')}>{t('For {email} — pick something with at least 8 characters. Your log is untouched.', { email: v.resetEmail })}</div>
            <div style={S('display:flex;flex-direction:column;gap:10px;padding-top:22px')}>
              <input placeholder={t('New password')} type="password" value={v.resetPw} onChange={v.setResetPw} style={S('width:100%;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:18px;padding:15px 18px;font-size:16.5px;color:#26231D;outline:none')} />
            </div>
            {v.resetError && (
              <div style={S('font-size:13px;line-height:1.4;color:#A85A45;padding-top:12px;text-wrap:pretty')}>{v.resetError}</div>
            )}
            <button type="button" onClick={v.submitReset} className="hov-olive" style={S('margin-top:18px;width:100%;height:60px;background:var(--accent);border:none;border-radius:999px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;font-family:inherit;box-shadow:0 8px 20px rgba(var(--accent-rgb),0.3)')}>
              <div style={S('font-size:17px;font-weight:700;color:#FCFBF6')}>{v.resetBusy ? t('One sec…') : t('Save new password')}</div>
              <Sym style={{ fontSize: 21, color: 'var(--on-accent)' }}>arrow_forward</Sym>
            </button>
            <div style={S('flex:1')} />
            <div style={S('font-size:12px;line-height:1.5;color:#B5AC98;text-align:center;padding-top:16px;text-wrap:pretty')}>{t('Reset links work once and expire after about an hour — ask for a fresh one from “Forgot password?” if this one is stale.')}</div>
          </div>
        )}

        {v.onboarding && (
          <div style={S('flex:1;display:flex;flex-direction:column;padding:24px 24px 20px;overflow:auto;position:relative;z-index:1;min-height:0')}>
            <div style={S('padding:6px 0 34px')}>
              <div style={S('display:flex;align-items:center;gap:6.4px')}>
                <Logo size={32} />
                <div style={S("font-family:'Nunito',sans-serif;font-weight:800;font-size:19px;letter-spacing:-0.02em")}><Wordmark /></div>
              </div>
            </div>
            <div style={S("font-family:'Nunito',sans-serif;font-weight:800;font-size:32px;line-height:1.1;letter-spacing:-0.025em;text-wrap:pretty")}>{t('Who are we keeping track of?')}</div>
            <div style={S('font-size:15px;line-height:1.5;color:#6E6659;padding-top:10px;text-wrap:pretty')}>{t('Two answers and you’re logging. Everything else can wait.')}</div>

            <div style={S('display:flex;flex-direction:column;gap:14px;padding-top:26px')}>
              <div style={S('display:flex;flex-direction:column;gap:7px')}>
                <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474")}>{t('Baby’s name')}</div>
                <input value={v.nameField} onChange={v.setName} placeholder="Wren" style={S('width:100%;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:16px;padding:15px 16px;font-size:17px;color:#26231D;outline:none')} />
              </div>

              <div style={S('display:flex;flex-direction:column;gap:7px')}>
                <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474")}>{t('Born on')}</div>
                <input type="date" value={v.dobField} onChange={v.setDob} max={v.today} style={S('width:100%;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:16px;padding:15px 16px;font-size:17px;color:#26231D;outline:none;font-family:inherit')} />
                <div style={S('font-size:12.5px;color:#8C8474;padding-left:2px')}>{t('So the log can think in their weeks — feeds, naps, and wake windows all change with age.')}</div>
              </div>

              <div style={S('display:flex;flex-direction:column;gap:7px')}>
                <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474")}>{t('Invite your partner or a caregiver')}</div>
                <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:16px;padding:4px 4px 4px 16px;display:flex;align-items:center;gap:8px')}>
                  <input value={v.inviteField} onChange={v.setInvite} placeholder="katrina@email.com" type="email" style={S('flex:1;min-width:0;background:none;border:none;padding:13px 0;font-size:16px;color:#26231D;outline:none')} />
                  <button type="button" onClick={v.sendInvite} style={S('background:rgba(var(--accent-rgb),0.14);border:none;border-radius:12px;padding:11px 14px;font-family:inherit;font-size:13.5px;font-weight:600;color:#5F6E42;cursor:pointer')}>{t('Invite')}</button>
                </div>
                <div style={S('display:flex;gap:6px')}>
                  {v.inviteRoleChips.map(c => (
                    <button key={c.key} type="button" onClick={c.onTap} style={S(`flex:1;background:${c.bg};border:1px solid ${c.border};border-radius:999px;padding:8px 6px;font-family:inherit;font-size:12.5px;font-weight:600;color:${c.fg};cursor:pointer`)}>{c.label}</button>
                  ))}
                </div>
                <div style={S('font-size:12.5px;color:#8C8474;padding-left:2px')}>{t('They see the same log live. No “when did you…” texts. Caregivers can log and cover shifts, but can’t change settings.')}</div>
              </div>
            </div>

            <div style={S('flex:1')} />
            <button type="button" onClick={v.finishOnboard} className="hov-olive" style={S('margin-top:24px;width:100%;height:60px;background:var(--accent);border:none;border-radius:999px;display:flex;align-items:center;justify-content:center;gap:9px;cursor:pointer;font-family:inherit;box-shadow:0 6px 18px rgba(var(--accent-rgb),0.3)')}>
              <div style={S('font-size:17px;font-weight:600;color:#FCFBF6;letter-spacing:-0.01em')}>{t('Start logging')}</div>
              <Sym style={{ fontSize: 21, color: 'var(--on-accent)' }}>arrow_forward</Sym>
            </button>
          </div>
        )}

        {v.isHome && (
          <div style={S('flex:1;display:flex;flex-direction:column;min-height:0;position:relative;z-index:1')}>
            <div style={S('padding:10px 20px 14px;display:flex;align-items:center;justify-content:space-between')}>
              <div style={S('display:flex;align-items:center;gap:10px')}>
                <Logo size={38} />
                <div style={S('display:flex;flex-direction:column;gap:1px')}>
                  <div style={S("font-family:'Nunito',sans-serif;font-weight:800;font-size:23px;letter-spacing:-0.02em")}>{v.babyName}</div>
                  <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;letter-spacing:0.06em")}>{v.ageLabel} · {v.dateLabel}{v.offline ? ' · ' + t('offline') : ''}</div>
                </div>
              </div>
              <div style={S('display:flex;align-items:center;gap:8px;flex-shrink:0')}>
                {/* the shift sheet, one tap from anywhere on Now — carries the
                    state the old inline cards spelled out: accent + a pulsing
                    dot when someone is asking you to take over. Solo households
                    have nobody to hand off to, so they get no button at all. */}
                {v.hasPartner && (
                  <button type="button" onClick={v.openShift} aria-label={v.shiftBtnLabel} title={v.shiftBtnLabel} className="hov-bd" style={S(`position:relative;width:38px;height:38px;padding:0;background:${v.shiftBtnBg};border:1px solid ${v.shiftBtnBorder};border-radius:999px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-family:inherit;flex-shrink:0`)}>
                    <Sym style={{ fontSize: 20, color: v.shiftBtnFg }}>pending_actions</Sym>
                    {v.shiftBtnDot && <div className="live-dot" style={S('position:absolute;top:2px;right:2px;width:9px;height:9px;border-radius:999px;background:var(--accent-deep);border:2px solid var(--surface)')} />}
                  </button>
                )}
                {/* Settings lives here now, not on History — an avatar that
                    opened Settings read as a profile switcher */}
                <button type="button" onClick={v.goSettings} aria-label={t('Settings')} className="hov-cream" style={S('width:38px;height:38px;padding:0;background:#FFFDF8;border:1px solid rgba(38,35,29,0.10);border-radius:999px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-family:inherit;flex-shrink:0')}>
                  <Sym style={{ fontSize: 20, color: 'var(--muted)' }}>settings</Sym>
                </button>
              </div>
            </div>

            {v.childPills && (
              <div style={S('display:flex;gap:8px;padding:0 20px 12px;overflow:auto')}>
                {v.childPills.map(c => (
                  <button key={c.id} type="button" onClick={c.onTap} className={c.on ? undefined : 'hov-bd'} style={S(`flex-shrink:0;background:${c.bg};border:1px solid ${c.border};border-radius:999px;padding:8px 16px;font-family:'Nunito',sans-serif;font-weight:700;font-size:13px;color:${c.fg};cursor:pointer;letter-spacing:-0.01em`)}>{c.label}</button>
                ))}
              </div>
            )}

            <div style={S('flex:1;overflow:auto;padding:0 16px 20px;min-height:0')}>

              {v.timers.map(tm => (
                <div key={tm.id} style={S(`background:#FFFDF8;border:1px solid ${tm.color};border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:14px 16px;margin-bottom:12px;display:flex;align-items:center;gap:13px;position:relative;overflow:hidden`)}>
                  <div style={S(`position:absolute;inset:0;opacity:0.06;background:${tm.color}`)} />
                  <div style={S('position:relative;width:42px;height:42px;border-radius:999px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0')}>
                    <div style={S(`position:absolute;inset:0;background:${tm.color};opacity:0.18`)} />
                    <Sym style={{ position: 'relative', fontSize: 22, color: tm.color }}>{tm.icon}</Sym>
                  </div>
                  <div style={S('position:relative;flex:1;min-width:0;display:flex;flex-direction:column;gap:1px')}>
                    <div style={S('font-size:15px;font-weight:700;letter-spacing:-0.01em')}>{tm.label}{tm.child ? ' · ' + tm.child : ''} · {tm.who}</div>
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:700;font-size:24px;letter-spacing:-0.03em;color:#3D392F;font-variant-numeric:tabular-nums")}>{tm.elapsed}</div>
                  </div>
                  {/* every timer stops from any phone — whoever came on duty
                      shouldn't have to wake the person who started it */}
                  <button type="button" onClick={tm.stop} className="hov-dark" style={S('position:relative;height:44px;padding:0 20px;background:#26231D;border:none;border-radius:999px;display:flex;align-items:center;gap:7px;cursor:pointer;font-family:inherit;flex-shrink:0')}>
                    <Sym style={{ fontSize: 18, color: 'var(--bg)' }}>stop</Sym>
                    <div style={S('font-size:14px;font-weight:700;color:#FAF6EF')}>{t('Stop')}</div>
                  </button>
                </div>
              ))}

              {v.incoming && (
                <div style={S('background:#FFFDF8;border:1px solid rgba(var(--accent-rgb),0.35);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:16px 16px 14px;margin-bottom:12px;display:flex;flex-direction:column;gap:12px')}>
                  <div style={S('display:flex;align-items:center;gap:10px')}>
                    <div style={S(`width:34px;height:34px;border-radius:999px;background:${v.requesterColor};display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#FCFBF6`)}>{v.requesterInitial}</div>
                    <div style={S('flex:1;display:flex;flex-direction:column;gap:1px')}>
                      <div style={S('font-size:15px;font-weight:700;letter-spacing:-0.01em')}>{t('{name} is handing off', { name: v.requesterName })}</div>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474")}>{v.requestAgo}</div>
                    </div>
                    <Sym style={{ fontSize: 22, color: 'var(--accent)' }}>swap_horiz</Sym>
                  </div>
                  <div style={S('font-size:15px;line-height:1.45;color:#4E4A3F;background:rgba(var(--accent-rgb),0.09);border-radius:16px;padding:12px 14px;text-wrap:pretty')}>“{v.requestNote}”</div>
                  <div style={S('display:flex;flex-direction:column;gap:6px')}>
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474")}>{t('The plan for your shift')}</div>
                    <div style={S('display:flex;flex-wrap:wrap;gap:6px')}>
                      {v.requestPlan.map((p, i) => (
                        <div key={i} style={S('display:flex;align-items:center;gap:6px;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;padding:6px 11px 6px 8px')}>
                          <Sym style={{ fontSize: 16, color: p.color }}>{p.icon}</Sym>
                          <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12.5px;color:#4E4A3F")}>{p.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={S('display:flex;gap:8px;padding-top:2px')}>
                    <button type="button" onClick={v.acceptShift} className="hov-olive" style={S('flex:1;height:50px;background:var(--accent);border:none;border-radius:999px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;font-family:inherit;box-shadow:0 6px 16px rgba(var(--accent-rgb),0.28)')}>
                      <Sym style={{ fontSize: 20, color: 'var(--on-accent)' }}>check</Sym>
                      <div style={S('font-size:15px;font-weight:700;color:#FCFBF6')}>{t('I’ve got him')}</div>
                    </button>
                    <button type="button" onClick={v.openShift} className="hov-cream" style={S('height:50px;padding:0 18px;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;cursor:pointer;font-family:inherit;font-size:14px;font-weight:600;color:#6E6659')}>{t('Details')}</button>
                  </div>
                </div>
              )}

              {/* your shift, their shift, and on-duty-not-started all live in
                  the shift sheet now (the header's pending_actions) — Now keeps only the
                  incoming ask above, because that one needs answering */}
              <div style={S('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
                {v.sinceCards.map((c, i) => (
                  <div key={i} style={S(`background:#FFFDF8;border:1px solid ${c.live ? c.color : 'rgba(38,35,29,0.07)'};border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:14px 15px 13px;display:flex;flex-direction:column;gap:7px;position:relative;overflow:hidden`)}>
                    <div style={S(`position:absolute;inset:0;opacity:${c.live ? '0.1' : '0.06'};background:${c.color}`)} />
                    <div style={S('display:flex;align-items:center;gap:7px;position:relative')}>
                      <div style={S('position:relative;width:26px;height:26px;border-radius:999px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0')}>
                        <div style={S(`position:absolute;inset:0;background:${c.color};opacity:0.18`)} />
                        <Sym style={{ position: 'relative', fontSize: 15, color: c.color }}>{c.icon}</Sym>
                      </div>
                      <div style={S("flex:1;min-width:0;font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#8C8474;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{c.label}</div>
                      {c.live && <div className="live-dot" style={S(`width:7px;height:7px;border-radius:999px;flex-shrink:0;background:${c.color}`)} />}
                    </div>
                    <div style={S('position:relative;display:flex;align-items:baseline;gap:4px')}>
                      <div style={S("font-family:'Nunito',sans-serif;font-size:26px;font-weight:700;letter-spacing:-0.04em;font-variant-numeric:tabular-nums")}>{c.elapsed}</div>
                      <div style={S('font-size:11px;color:#8C8474')}>{c.unit}</div>
                    </div>
                    <div style={S('position:relative;font-size:11.5px;color:#6E6659')}>{c.at}</div>
                  </div>
                ))}
              </div>

              <div style={S('display:flex;align-items:center;justify-content:space-between;padding:22px 4px 9px')}>
                <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;color:#8C8474")}>{t('Today')}</div>
                <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;letter-spacing:0.04em")}>{v.todaySummary}</div>
              </div>

              <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);overflow:hidden')}>
                {v.timeline.length === 0 && (
                  <div style={S('padding:22px 16px;text-align:center;font-size:13.5px;color:#B5AC98;text-wrap:pretty')}>{t('Nothing logged yet — tap + and you’re three taps from done.')}</div>
                )}
                {v.timeline.map((e, i) => e.timer ? (
                  // a running timer holding its place in the day, with the same
                  // one-tap Stop as the top card. box-sizing matters: entry rows
                  // are <button>s (border-box by default) but this is a <div>,
                  // and without it the padding pushes the right-side control
                  // past the card's overflow:hidden
                  <div key={'timer-' + e.id} style={S('width:100%;box-sizing:border-box;border-top:1px solid rgba(38,35,29,0.06);padding:13px 15px;display:flex;align-items:center;gap:12px;text-align:left')}>
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12.5px;color:#6E6659;width:62px;flex-shrink:0;letter-spacing:-0.02em")}>{e.time}</div>
                    <div style={S('position:relative;width:36px;height:36px;border-radius:999px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0')}>
                      <div style={S(`position:absolute;inset:0;background:${e.color};opacity:0.16`)} />
                      <Sym style={{ position: 'relative', fontSize: 19, color: e.color }}>{e.icon}</Sym>
                    </div>
                    <div style={S('flex:1;min-width:0;display:flex;flex-direction:column;gap:1px')}>
                      <div style={S('font-size:15px;font-weight:600;letter-spacing:-0.01em')}>{e.label}</div>
                      <div style={S('font-size:11.5px;color:#8C8474;font-variant-numeric:tabular-nums')}>{e.sub}</div>
                    </div>
                    <button type="button" onClick={e.onStop} className="hov-dark" style={S('height:34px;padding:0 14px;background:#26231D;border:none;border-radius:999px;display:flex;align-items:center;gap:6px;cursor:pointer;font-family:inherit;flex-shrink:0')}>
                      <Sym style={{ fontSize: 15, color: 'var(--bg)' }}>stop</Sym>
                      <div style={S('font-size:12.5px;font-weight:700;color:#FAF6EF')}>{t('Stop')}</div>
                    </button>
                  </div>
                ) : (
                  <button key={i} type="button" onClick={e.onEdit} className="hov-row" style={S('width:100%;background:none;border:none;border-top:1px solid rgba(38,35,29,0.06);padding:13px 15px;display:flex;align-items:center;gap:12px;cursor:pointer;text-align:left;font-family:inherit')}>
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12.5px;color:#6E6659;width:62px;flex-shrink:0;letter-spacing:-0.02em")}>{e.time}</div>
                    <div style={S('position:relative;width:36px;height:36px;border-radius:999px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0')}>
                      <div style={S(`position:absolute;inset:0;background:${e.color};opacity:0.16`)} />
                      <Sym style={{ position: 'relative', fontSize: 19, color: e.color }}>{e.icon}</Sym>
                    </div>
                    <div style={S('flex:1;min-width:0;display:flex;flex-direction:column;gap:1px')}>
                      <div style={S('font-size:15px;font-weight:600;letter-spacing:-0.01em')}>{e.label}</div>
                      <div style={S('font-size:11.5px;color:#8C8474')}>{e.sub}{e.pending && <PendingDot />}</div>
                    </div>
                    {e.byChip && (
                      <div title={t('Logged by {name}', { name: e.byChip.name })} style={S(`width:20px;height:20px;border-radius:999px;background:${e.byChip.color};display:flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:700;color:#FCFBF6;flex-shrink:0`)}>{e.byChip.initial}</div>
                    )}
                    <Sym style={{ fontSize: 18, color: 'var(--dim)', flexShrink: 0 }}>chevron_right</Sym>
                  </button>
                ))}
              </div>
              <div style={S('text-align:center;padding:14px 0 0;font-size:12.5px;color:#B5AC98')}>{t('Older days live in History')}</div>
            </div>
          </div>
        )}

        {v.isHistory && (
          <div style={S('flex:1;display:flex;flex-direction:column;min-height:0;position:relative;z-index:1')}>
            <div style={S('padding:10px 20px 12px;display:flex;align-items:center;gap:10px')}>
              {v.dayView ? (
                <>
                  <button type="button" onClick={v.dayView.back} className="hov-cream" style={S('width:38px;height:38px;background:#FFFDF8;border:1px solid rgba(38,35,29,0.10);border-radius:999px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0')}>
                    <Sym style={{ fontSize: 20, color: 'var(--muted)' }}>arrow_back</Sym>
                  </button>
                  <div style={S('display:flex;flex-direction:column;gap:1px;min-width:0')}>
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:800;font-size:23px;letter-spacing:-0.02em;white-space:nowrap")}>{v.dayView.label}</div>
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;letter-spacing:0.06em")}>{v.dayView.sub}</div>
                  </div>
                  <div style={S('flex:1')} />
                  <button type="button" disabled={!v.dayView.prev} onClick={v.dayView.prev || undefined} className="hov-cream" style={S(`width:38px;height:38px;background:#FFFDF8;border:1px solid rgba(38,35,29,0.10);border-radius:999px;display:flex;align-items:center;justify-content:center;cursor:${v.dayView.prev ? 'pointer' : 'default'};flex-shrink:0`)}>
                    <Sym style={{ fontSize: 20, color: v.dayView.prev ? 'var(--muted)' : 'var(--faint)' }}>chevron_left</Sym>
                  </button>
                  <button type="button" disabled={!v.dayView.next} onClick={v.dayView.next || undefined} className="hov-cream" style={S(`width:38px;height:38px;background:#FFFDF8;border:1px solid rgba(38,35,29,0.10);border-radius:999px;display:flex;align-items:center;justify-content:center;cursor:${v.dayView.next ? 'pointer' : 'default'};flex-shrink:0`)}>
                    <Sym style={{ fontSize: 20, color: v.dayView.next ? 'var(--muted)' : 'var(--faint)' }}>chevron_right</Sym>
                  </button>
                </>
              ) : (
                <>
                  <Logo size={38} />
                  <div style={S('display:flex;flex-direction:column;gap:1px')}>
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:800;font-size:23px;letter-spacing:-0.02em")}>{t('Last 7 days')}</div>
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;letter-spacing:0.06em")}>{v.historySubtitle}</div>
                  </div>
                  {/* no Settings cog here — Now owns that door, so Settings
                      has one way in and one way back */}
                </>
              )}
            </div>

            {v.childPills && !v.dayView && (
              <div style={S('display:flex;gap:8px;padding:0 20px 12px;overflow:auto')}>
                {v.childPills.map(c => (
                  <button key={c.id} type="button" onClick={c.onTap} className={c.on ? undefined : 'hov-bd'} style={S(`flex-shrink:0;background:${c.bg};border:1px solid ${c.border};border-radius:999px;padding:8px 16px;font-family:'Nunito',sans-serif;font-weight:700;font-size:13px;color:${c.fg};cursor:pointer;letter-spacing:-0.01em`)}>{c.label}</button>
                ))}
              </div>
            )}

            <div style={S('flex:1;overflow:auto;padding:0 16px 20px;min-height:0')}>
              {v.dayView ? (
                <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);overflow:hidden')}>
                  {v.dayView.rows.length === 0 && (
                    <div style={S('padding:22px 16px;text-align:center;font-size:13.5px;color:#B5AC98;text-wrap:pretty')}>{t('Nothing logged this day.')}</div>
                  )}
                  {v.dayView.rows.map((e, i) => (
                    <button key={i} type="button" onClick={e.onEdit} className="hov-row" style={S('width:100%;background:none;border:none;border-top:1px solid rgba(38,35,29,0.06);padding:13px 15px;display:flex;align-items:center;gap:12px;cursor:pointer;text-align:left;font-family:inherit')}>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12.5px;color:#6E6659;width:62px;flex-shrink:0;letter-spacing:-0.02em")}>{e.time}</div>
                      <div style={S('position:relative;width:36px;height:36px;border-radius:999px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0')}>
                        <div style={S(`position:absolute;inset:0;background:${e.color};opacity:0.16`)} />
                        <Sym style={{ position: 'relative', fontSize: 19, color: e.color }}>{e.icon}</Sym>
                      </div>
                      <div style={S('flex:1;min-width:0;display:flex;flex-direction:column;gap:1px')}>
                        <div style={S('font-size:15px;font-weight:600;letter-spacing:-0.01em')}>{e.label}</div>
                        <div style={S('font-size:11.5px;color:#8C8474')}>{e.sub}{e.pending && <PendingDot />}</div>
                      </div>
                      {e.byChip && (
                        <div title={t('Logged by {name}', { name: e.byChip.name })} style={S(`width:20px;height:20px;border-radius:999px;background:${e.byChip.color};display:flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:700;color:#FCFBF6;flex-shrink:0`)}>{e.byChip.initial}</div>
                      )}
                      <Sym style={{ fontSize: 18, color: 'var(--dim)', flexShrink: 0 }}>chevron_right</Sym>
                    </button>
                  ))}
                </div>
              ) : (
              <>
              <div style={S('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
                {v.stats.map((st, i) => (
                  <div key={i} style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:24px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:13px 15px;display:flex;flex-direction:column;gap:4px')}>
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#8C8474")}>{st.label}</div>
                    <div style={S('display:flex;align-items:baseline;gap:4px')}>
                      <div style={S("font-family:'Nunito',sans-serif;font-size:24px;font-weight:700;letter-spacing:-0.04em")}>{st.value}</div>
                      <div style={S('font-size:11px;color:#8C8474')}>{st.unit}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:16px 16px 12px;margin-top:12px')}>
                <div style={S('display:flex;align-items:center;justify-content:space-between;padding-bottom:14px')}>
                  <div style={S('font-size:15px;font-weight:600;letter-spacing:-0.01em')}>{t('Feeds per day')}</div>
                  <div style={S('display:flex;align-items:center;gap:6px')}>
                    <div style={S('width:9px;height:9px;border-radius:3px;background:oklch(0.60 0.075 130)')} />
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#8C8474;letter-spacing:0.06em")}>{v.feedUnitLabel}</div>
                  </div>
                </div>
                <div style={S('display:flex;align-items:flex-end;gap:8px;height:118px')}>
                  {v.feedBars.map((b, i) => (
                    <button key={i} type="button" onClick={b.onTap} style={S('flex:1;display:flex;flex-direction:column;align-items:center;gap:7px;height:100%;justify-content:flex-end;background:none;border:none;padding:0;cursor:pointer;font-family:inherit')}>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#6E6659")}>{b.value}</div>
                      <div style={S(`width:100%;border-radius:8px 8px 3px 3px;background:${b.fill};height:${b.h}`)} />
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;letter-spacing:0.08em;color:#A79E8B")}>{b.day}</div>
                    </button>
                  ))}
                </div>
              </div>

              {v.showDiaperChart && (
              <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:16px 16px 12px;margin-top:12px')}>
                <div style={S('display:flex;align-items:center;justify-content:space-between;padding-bottom:14px')}>
                  <div style={S('font-size:15px;font-weight:600;letter-spacing:-0.01em')}>{t('Diapers per day')}</div>
                  <div style={S('display:flex;align-items:center;gap:6px')}>
                    <div style={S('width:9px;height:9px;border-radius:3px;background:oklch(0.60 0.075 210)')} />
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#8C8474;letter-spacing:0.06em")}>{t('changes')}</div>
                  </div>
                </div>
                <div style={S('display:flex;align-items:flex-end;gap:8px;height:104px')}>
                  {v.diaperBars.map((b, i) => (
                    <button key={i} type="button" onClick={b.onTap} style={S('flex:1;display:flex;flex-direction:column;align-items:center;gap:7px;height:100%;justify-content:flex-end;background:none;border:none;padding:0;cursor:pointer;font-family:inherit')}>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#6E6659")}>{b.value}</div>
                      <div style={S(`width:100%;border-radius:8px 8px 3px 3px;background:${b.fill};height:${b.h}`)} />
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;letter-spacing:0.08em;color:#A79E8B")}>{b.day}</div>
                    </button>
                  ))}
                </div>
              </div>
              )}

              <div style={S('background:rgba(var(--accent-rgb),0.10);border:1px solid rgba(var(--accent-rgb),0.22);border-radius:22px;padding:16px;margin-top:12px;display:flex;gap:12px;align-items:flex-start')}>
                <Sym style={{ fontSize: 20, color: 'var(--accent-text)', flexShrink: 0 }}>insights</Sym>
                <div style={S('display:flex;flex-direction:column;gap:3px')}>
                  <div style={S('font-size:14.5px;font-weight:600;color:var(--accent-deep)')}>{v.patternTitle}</div>
                  <div style={S('font-size:13px;line-height:1.5;color:#5F6E42;text-wrap:pretty')}>{v.patternBody}</div>
                </div>
              </div>

              {v.wakeInsight && (
                <div style={S('background:rgba(var(--accent-rgb),0.10);border:1px solid rgba(var(--accent-rgb),0.22);border-radius:22px;padding:16px;margin-top:12px;display:flex;gap:12px;align-items:flex-start')}>
                  <Sym style={{ fontSize: 20, color: 'var(--accent-text)', flexShrink: 0 }}>wb_twilight</Sym>
                  <div style={S('display:flex;flex-direction:column;gap:3px')}>
                    <div style={S('font-size:14.5px;font-weight:600;color:var(--accent-deep)')}>{v.wakeInsight.title}</div>
                    <div style={S('font-size:13px;line-height:1.5;color:#5F6E42;text-wrap:pretty')}>{v.wakeInsight.body}</div>
                  </div>
                </div>
              )}

              <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 0 4px;margin-top:12px;overflow:hidden')}>
                <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;padding:10px 16px 6px")}>{t('All days')}</div>
                {v.historyDays.map((d, i) => (
                  <button key={d.key} type="button" onClick={d.onTap} className="hov-row" style={S('width:100%;background:none;border:none;border-top:1px solid rgba(38,35,29,0.06);padding:12px 16px;display:flex;align-items:center;gap:12px;cursor:pointer;text-align:left;font-family:inherit')}>
                    <div style={S('flex:1;min-width:0;display:flex;flex-direction:column;gap:1px')}>
                      <div style={S('font-size:14.5px;font-weight:600;letter-spacing:-0.01em')}>{d.label}</div>
                      <div style={S('font-size:11.5px;color:#8C8474')}>{d.sub}</div>
                    </div>
                    <Sym style={{ fontSize: 18, color: 'var(--dim)', flexShrink: 0 }}>chevron_right</Sym>
                  </button>
                ))}
              </div>

              {v.trackRec && (
                <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:22px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:16px;margin-top:12px;display:flex;flex-direction:column;gap:12px')}>
                  <div style={S('display:flex;gap:12px;align-items:flex-start')}>
                    <Sym style={{ fontSize: 20, color: 'var(--soft)', flexShrink: 0 }}>visibility_off</Sym>
                    <div style={S('display:flex;flex-direction:column;gap:3px')}>
                      <div style={S('font-size:14.5px;font-weight:600')}>{v.trackRec.title}</div>
                      <div style={S('font-size:13px;line-height:1.5;color:#6E6659;text-wrap:pretty')}>{v.trackRec.body}</div>
                    </div>
                  </div>
                  <div style={S('display:flex;gap:8px')}>
                    <button type="button" onClick={v.trackRec.turnOff} style={S('flex:1;background:rgba(var(--accent-rgb),0.16);border:1px solid var(--accent);border-radius:999px;padding:10px 6px;font-family:inherit;font-size:13px;font-weight:600;color:var(--accent-deep);cursor:pointer')}>{v.trackRec.offLabel}</button>
                    <button type="button" onClick={v.trackRec.keep} className="hov-cream" style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;padding:10px 18px;font-family:inherit;font-size:13px;font-weight:600;color:#6E6659;cursor:pointer')}>{t('Keep')}</button>
                  </div>
                </div>
              )}

              </>
              )}
            </div>
          </div>
        )}

        {v.isSettings && (
          <div style={S('flex:1;display:flex;flex-direction:column;min-height:0;position:relative;z-index:1')}>
            <div style={S('padding:10px 20px 12px;display:flex;align-items:center;gap:10px')}>
              <button type="button" onClick={v.settingsBack} className="hov-cream" style={S('width:38px;height:38px;background:#FFFDF8;border:1px solid rgba(38,35,29,0.10);border-radius:999px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0')}>
                <Sym style={{ fontSize: 20, color: 'var(--muted)' }}>arrow_back</Sym>
              </button>
              <div style={S('display:flex;flex-direction:column;gap:1px')}>
                <div style={S("font-family:'Nunito',sans-serif;font-weight:800;font-size:23px;letter-spacing:-0.02em")}>{t('Settings')}</div>
                <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;letter-spacing:0.06em")}>{t('{name}’s log', { name: v.primaryBabyName })}</div>
              </div>
            </div>

            <div style={S('flex:1;overflow:auto;padding:0 16px 20px;min-height:0')}>
              {v.childrenCard ? (
                <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px 12px')}>
                  <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;padding:10px 0 4px")}>{v.childrenCard.header}</div>
                  {v.childrenCard.canEdit ? v.childrenCard.rows.map(c => (
                    <React.Fragment key={c.id}>
                      <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                        <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 80)' }}>child_care</Sym>
                        <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Name')}</div>
                        <input value={c.name} onChange={c.setName} onBlur={c.saveName} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} placeholder={t('Baby')} style={S("width:140px;box-sizing:border-box;text-align:right;background:rgba(38,35,29,0.04);border:none;border-radius:12px;padding:8px 10px;font-size:13.5px;color:#26231D;outline:none;font-family:'Nunito',sans-serif;font-weight:600")} />
                      </div>
                      <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                        <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 350)' }}>cake</Sym>
                        <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Born on')}</div>
                        <input type="date" value={c.birthdate} onChange={c.setDob} max={v.today} style={S("background:rgba(38,35,29,0.04);border:none;border-radius:12px;padding:8px 10px;font-size:13.5px;color:#26231D;outline:none;font-family:'Nunito',sans-serif;font-weight:600")} />
                      </div>
                      {!c.primary && (
                        <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                          <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 210)' }}>visibility</Sym>
                          <div style={S('flex:1')}>
                            <div style={S('font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Show {name} in the app', { name: c.plainName })}</div>
                            <div style={S('font-size:11.5px;color:#B5AC98;padding-top:1px')}>{t('Off tucks them out of the pills — their log stays')}</div>
                          </div>
                          <button type="button" onClick={c.onArchive} style={S('background:none;border:none;padding:0;cursor:pointer;display:flex')}>
                            <Sym style={{ fontSize: 22, color: c.archived ? 'var(--dim)' : 'var(--accent)' }}>{c.archived ? 'toggle_off' : 'toggle_on'}</Sym>
                          </button>
                        </div>
                      )}
                    </React.Fragment>
                  )) : v.childrenCard.rows.map(c => (
                    <div key={c.id} style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                      <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 80)' }}>child_care</Sym>
                      <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{c.plainName}{c.archived ? ' · ' + t('hidden') : ''}</div>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:13.5px;color:#26231D")}>{c.ageText}</div>
                    </div>
                  ))}
                  {v.childrenCard.canAdd && (
                    <>
                      <button type="button" onClick={v.childrenCard.toggleAdd} className="hov-row" style={S('width:100%;background:none;border:none;display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07);cursor:pointer;font-family:inherit;text-align:left;border-radius:10px')}>
                        <Sym style={{ fontSize: 18, color: 'var(--accent)' }}>person_add</Sym>
                        <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Add a child')}</div>
                        <Sym style={{ fontSize: 18, color: 'var(--dim)' }}>{v.childrenCard.addOpen ? 'expand_less' : 'expand_more'}</Sym>
                      </button>
                      {v.childrenCard.addOpen && (
                        <div style={S('display:flex;flex-direction:column;gap:8px;padding:2px 0 10px 29px')}>
                          <input placeholder={t('Their name')} value={v.childrenCard.addName} onChange={v.childrenCard.setAddName} style={S('width:100%;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;padding:11px 16px;font-size:14.5px;color:#26231D;outline:none')} />
                          <input type="date" value={v.childrenCard.addDob} onChange={v.childrenCard.setAddDob} max={v.today} style={S("width:100%;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;padding:11px 16px;font-size:14.5px;color:#26231D;outline:none;font-family:inherit")} />
                          <button type="button" onClick={v.childrenCard.submitAdd} className="hov-olive" style={S('align-self:flex-start;height:42px;padding:0 18px;background:var(--accent);border:none;border-radius:999px;cursor:pointer;font-family:inherit;font-size:13.5px;font-weight:700;color:#FCFBF6')}>{v.childrenCard.addBusy ? t('One sec…') : t('Add them')}</button>
                          <div style={S('font-size:11.5px;color:#B5AC98;text-wrap:pretty')}>{t('Their birthday keeps feeds, naps and wake windows compared against the right age.')}</div>
                        </div>
                      )}
                    </>
                  )}
                  <div style={S('font-size:12px;color:#B5AC98;padding-top:6px;text-wrap:pretty')}>{v.childrenCard.hint}</div>
                </div>
              ) : (
                <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px 12px')}>
                  <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;padding:10px 0 4px")}>{t('About {name}', { name: v.primaryBabyName })}</div>
                  <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                    <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 80)' }}>child_care</Sym>
                    <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Name')}</div>
                    <input value={v.account.babyName} onChange={v.account.setBabyName} onBlur={v.account.saveBabyName} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} placeholder={t('Baby')} style={S("width:140px;box-sizing:border-box;text-align:right;background:rgba(38,35,29,0.04);border:none;border-radius:12px;padding:8px 10px;font-size:13.5px;color:#26231D;outline:none;font-family:'Nunito',sans-serif;font-weight:600")} />
                  </div>
                  <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                    <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 350)' }}>cake</Sym>
                    <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Born on')}</div>
                    <input type="date" value={v.birthdate} onChange={v.setBirthdate} max={v.today} style={S("background:rgba(38,35,29,0.04);border:none;border-radius:12px;padding:8px 10px;font-size:13.5px;color:#26231D;outline:none;font-family:'Nunito',sans-serif;font-weight:600")} />
                  </div>
                  <div style={S('font-size:12px;color:#B5AC98;padding-top:6px;text-wrap:pretty')}>{v.ageLine}</div>
                </div>
              )}

              <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px 12px;margin-top:12px')}>
                <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;padding:10px 0 4px")}>{t('Your household')}</div>
                {v.household.members.map(m => (
                  <div key={m.id} style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                    <div style={S(`width:26px;height:26px;border-radius:999px;background:${m.color};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#FCFBF6;flex-shrink:0`)}>{m.initial}</div>
                    <div style={S('flex:1;min-width:0;font-size:14px;font-weight:600;color:#4E4A3F;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{m.name}{m.isMe ? ' ' + t('(you)') : ''}</div>
                    <div style={S(`flex-shrink:0;border-radius:999px;padding:4px 10px;font-family:'Nunito',sans-serif;font-weight:600;font-size:10.5px;background:${m.roleParent ? 'rgba(var(--accent-rgb),0.14)' : 'rgba(38,35,29,0.06)'};color:${m.roleParent ? 'var(--accent-deep)' : '#8C8474'}`)}>{m.roleLabel}</div>
                    {m.canRemove && !m.armed && (
                      <button type="button" onClick={m.arm} className="hov-bd" style={S("flex-shrink:0;background:none;border:1px solid rgba(38,35,29,0.14);border-radius:999px;padding:6px 12px;font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;color:#8C8474;cursor:pointer")}>{t('Remove')}</button>
                    )}
                    {m.canRemove && m.armed && (
                      <>
                        <button type="button" onClick={m.remove} style={S("flex-shrink:0;background:#A85A45;border:none;border-radius:999px;padding:7px 12px;font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;color:#FCFBF6;cursor:pointer")}>{t('Yes, remove')}</button>
                        <button type="button" onClick={m.disarm} className="hov-bd" style={S("flex-shrink:0;background:none;border:1px solid rgba(38,35,29,0.14);border-radius:999px;padding:6px 12px;font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;color:#8C8474;cursor:pointer")}>{t('Keep')}</button>
                      </>
                    )}
                  </div>
                ))}
                {v.household.invites.map(i => (
                  <React.Fragment key={i.email}>
                    <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                      <Sym style={{ fontSize: 18, color: 'var(--soft)' }}>mail</Sym>
                      <div style={S('flex:1;min-width:0')}>
                        <div style={S('font-size:14px;font-weight:600;color:#4E4A3F;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{i.email}</div>
                        <div style={S('font-size:11.5px;color:#B5AC98;padding-top:1px')}>{t('invited — hasn’t joined yet')}</div>
                      </div>
                      <div style={S(`flex-shrink:0;border-radius:999px;padding:4px 10px;font-family:'Nunito',sans-serif;font-weight:600;font-size:10.5px;background:${i.roleParent ? 'rgba(var(--accent-rgb),0.14)' : 'rgba(38,35,29,0.06)'};color:${i.roleParent ? 'var(--accent-deep)' : '#8C8474'}`)}>{i.roleLabel}</div>
                      {i.resend && (
                        <button type="button" onClick={i.resend} className="hov-bd" style={S("flex-shrink:0;background:none;border:1px solid rgba(38,35,29,0.14);border-radius:999px;padding:6px 12px;font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;color:#8C8474;cursor:pointer")}>{t('Resend')}</button>
                      )}
                      {i.revoke && (
                        <button type="button" onClick={i.revoke} className="hov-bd" style={S("flex-shrink:0;background:none;border:1px solid rgba(38,35,29,0.14);border-radius:999px;padding:6px 12px;font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;color:#A85A45;cursor:pointer")}>{t('Revoke')}</button>
                      )}
                    </div>
                    {i.code && (
                      <div style={S('display:flex;align-items:center;gap:8px;padding:0 0 8px 29px')}>
                        <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#8C8474")}>{t('Their code')}</div>
                        <div style={S("font-family:'Nunito',sans-serif;font-weight:800;font-size:14px;letter-spacing:0.14em;color:#26231D")}>{i.code}</div>
                        <button type="button" onClick={i.copyCode} className="hov-bd" style={S("background:none;border:1px solid rgba(38,35,29,0.14);border-radius:999px;padding:5px 11px;font-family:'Nunito',sans-serif;font-weight:600;font-size:10.5px;color:#8C8474;cursor:pointer")}>{t('Copy')}</button>
                      </div>
                    )}
                  </React.Fragment>
                ))}
                {v.household.canInvite && (
                  <>
                    <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0 4px;border-top:1px solid rgba(38,35,29,0.07)')}>
                      <Sym style={{ fontSize: 18, color: 'var(--accent)' }}>person_add</Sym>
                      <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Invite your partner or a caregiver')}</div>
                    </div>
                    <div style={S('display:flex;gap:6px;padding:2px 0 8px 29px')}>
                      {v.inviteRoleChips.map(c => (
                        <button key={c.key} type="button" onClick={c.onTap} style={S(`flex:1;background:${c.bg};border:1px solid ${c.border};border-radius:999px;padding:8px 6px;font-family:inherit;font-size:12.5px;font-weight:600;color:${c.fg};cursor:pointer`)}>{c.label}</button>
                      ))}
                    </div>
                    <div style={S('display:flex;gap:8px;padding:0 0 8px 29px')}>
                      <input placeholder="their@email.com" type="email" value={v.inviteField} onChange={v.setInvite} style={S('flex:1;min-width:0;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;padding:11px 16px;font-size:14.5px;color:#26231D;outline:none')} />
                      <button type="button" onClick={v.sendInvite} className="hov-olive" style={S('height:42px;padding:0 18px;background:var(--accent);border:none;border-radius:999px;cursor:pointer;font-family:inherit;font-size:13.5px;font-weight:700;color:#FCFBF6;flex-shrink:0;align-self:center')}>{t('Invite')}</button>
                    </div>
                  </>
                )}
                {v.household.full && (
                  <div style={S('font-size:12px;color:#B5AC98;padding-top:6px;text-wrap:pretty')}>{t('This log is at its {n}-grown-up limit — remove someone (or revoke an invite) to free a seat.', { n: v.household.capWord })}</div>
                )}
                <div style={S('font-size:12px;color:#B5AC98;padding-top:6px;text-wrap:pretty')}>{v.household.hint}</div>
              </div>

              <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px 12px;margin-top:12px')}>
                <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;padding:10px 0 4px")}>{t('Appearance')}</div>
                {v.canManage && (
                <>
                <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0 4px;border-top:1px solid rgba(38,35,29,0.07)')}>
                  <Sym style={{ fontSize: 18, color: 'var(--accent)' }}>palette</Sym>
                  <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Accent')}</div>
                </div>
                <div style={S('display:flex;gap:10px;padding:2px 0 8px 29px;overflow:auto')}>
                  {v.appearance.accents.map(a => (
                    <button key={a.key} type="button" onClick={a.onTap} title={a.label} aria-label={a.label} style={S(`flex-shrink:0;width:34px;height:34px;border-radius:999px;background:${a.color};border:2px solid ${a.on ? 'var(--ink)' : 'rgba(var(--ink-rgb),0.10)'};padding:0;cursor:pointer;display:flex;align-items:center;justify-content:center`)}>
                      {a.on && <Sym style={{ fontSize: 16, color: 'var(--on-accent)' }}>check</Sym>}
                    </button>
                  ))}
                </div>
                <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0 4px;border-top:1px solid rgba(38,35,29,0.07)')}>
                  <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 80)' }}>wallpaper</Sym>
                  <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Background')}</div>
                </div>
                <div style={S('display:flex;gap:10px;padding:2px 0 8px 29px;overflow:auto')}>
                  {v.appearance.bgs.map(b => (
                    // background lives outside S() so the cream swatch keeps its literal color in dark mode
                    <button key={b.key} type="button" onClick={b.onTap} title={b.label} aria-label={b.label} style={{ ...S(`flex-shrink:0;width:34px;height:34px;border-radius:999px;border:2px solid ${b.on ? 'var(--ink)' : 'rgba(var(--ink-rgb),0.14)'};padding:0;cursor:pointer;display:flex;align-items:center;justify-content:center`), background: b.color }}>
                      {b.on && <Sym style={{ fontSize: 16, color: '#26231D' /* swatch itself is always light */ }}>check</Sym>}
                    </button>
                  ))}
                </div>
                </>
                )}
                <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0 4px;border-top:1px solid rgba(38,35,29,0.07)')}>
                  <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 300)' }}>dark_mode</Sym>
                  <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Theme')}</div>
                </div>
                <div style={S('display:flex;gap:8px;padding:2px 0 8px 29px')}>
                  {v.appearance.modes.map(m => (
                    <button key={m.key} type="button" onClick={m.onTap} className={m.on ? undefined : 'hov-bd'} style={S(`flex:1;height:34px;border-radius:999px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;background:${m.on ? 'rgba(var(--accent-rgb),0.16)' : 'var(--surface)'};border:1px solid ${m.on ? 'var(--accent)' : 'rgba(var(--ink-rgb),0.12)'};color:${m.on ? 'var(--accent-deep)' : 'var(--muted)'}`)}>{m.label}</button>
                  ))}
                </div>
                <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                  <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 210)' }}>screen_rotation</Sym>
                  <div style={S('flex:1')}>
                    <div style={S('font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Tilt parallax')}</div>
                    <div style={S('font-size:11.5px;color:#B5AC98;padding-top:1px')}>{t('The background drifts as the phone tilts')}</div>
                  </div>
                  <button type="button" onClick={v.appearance.tilt.onToggle} style={S('background:none;border:none;padding:0;cursor:pointer;display:flex')}>
                    <Sym style={{ fontSize: 22, color: v.appearance.tilt.on ? 'var(--accent)' : 'var(--dim)' }}>{v.appearance.tilt.on ? 'toggle_on' : 'toggle_off'}</Sym>
                  </button>
                </div>
                <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0 4px;border-top:1px solid rgba(38,35,29,0.07)')}>
                  <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 25)' }}>timer</Sym>
                  <div style={S('flex:1')}>
                    <div style={S('font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Running timers')}</div>
                    <div style={S('font-size:11.5px;color:#B5AC98;padding-top:1px')}>{t('Cards up top, rows in the Today list, or both')}</div>
                  </div>
                </div>
                <div style={S('display:flex;gap:8px;padding:2px 0 8px 29px')}>
                  {v.appearance.timerSpots.map(m => (
                    <button key={m.key} type="button" onClick={m.onTap} className={m.on ? undefined : 'hov-bd'} style={S(`flex:1;height:34px;border-radius:999px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;background:${m.on ? 'rgba(var(--accent-rgb),0.16)' : 'var(--surface)'};border:1px solid ${m.on ? 'var(--accent)' : 'rgba(var(--ink-rgb),0.12)'};color:${m.on ? 'var(--accent-deep)' : 'var(--muted)'}`)}>{m.label}</button>
                  ))}
                </div>
                <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                  <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 95)' }}>tune</Sym>
                  <div style={S('flex:1')}>
                    <div style={S('font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Advanced log options')}</div>
                    <div style={S('font-size:11.5px;color:#B5AC98;padding-top:1px')}>{t('The log sheet opens with the day picker already out')}</div>
                  </div>
                  <button type="button" onClick={v.appearance.advancedLog.onToggle} aria-label={t('Advanced log options')} aria-pressed={v.appearance.advancedLog.on} style={S('background:none;border:none;padding:0;cursor:pointer;display:flex')}>
                    <Sym style={{ fontSize: 22, color: v.appearance.advancedLog.on ? 'var(--accent)' : 'var(--dim)' }}>{v.appearance.advancedLog.on ? 'toggle_on' : 'toggle_off'}</Sym>
                  </button>
                </div>
                <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                  <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 130)' }}>language</Sym>
                  <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Language')}</div>
                  {/* options render in each language's own name, so this row is
                      findable even when the app is in a language you can't read */}
                  <select value={v.appearance.lang} onChange={v.appearance.setLang} style={S("background:rgba(38,35,29,0.04);border:none;border-radius:12px;padding:8px 10px;font-size:13.5px;color:#26231D;outline:none;font-family:'Nunito',sans-serif;font-weight:600")}>
                    {v.appearance.langs.map(l => (
                      <option key={l.code} value={l.code}>{l.label}</option>
                    ))}
                  </select>
                </div>
                {/* the line stopped enumerating when the fourth device pref landed —
                    an incomplete list reads as "the rest of these do sync" */}
                <div style={S('font-size:12px;color:#B5AC98;padding-top:6px;text-wrap:pretty')}>{t(v.canManage ? 'Colors are shared with your partner. Everything else here stays on this phone.' : 'Everything here stays on this phone — the colors are the household’s, set by a parent.')}</div>
              </div>

              {v.canManage && (
              <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px 12px;margin-top:12px')}>
                <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;padding:10px 0 4px")}>{t('Now screen cards')}</div>
                {v.widgetRows.map((r, i) => (
                  <div key={i} style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                    <Sym style={{ fontSize: 18, color: r.color }}>{r.icon}</Sym>
                    <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{r.label}</div>
                    <button type="button" onClick={r.onToggle} style={S('background:none;border:none;padding:0;cursor:pointer;display:flex')}>
                      <Sym style={{ fontSize: 22, color: r.toggleColor }}>{r.toggleIcon}</Sym>
                    </button>
                  </div>
                ))}
                <div style={S('font-size:12px;color:#B5AC98;padding-top:8px;text-wrap:pretty')}>{t('These are the “time since last …” cards at the top of Now. Only things you track can appear here.')}</div>
              </div>
              )}

              {v.canManage && (
              <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px 12px;margin-top:12px')}>
                <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;padding:10px 0 4px")}>{t('What you track')}</div>
                {v.trackRows.map(r => (
                  <React.Fragment key={r.key}>
                    <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                      <Sym style={{ fontSize: 18, color: r.color }}>{r.icon}</Sym>
                      <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{r.label}</div>
                      <button type="button" onClick={r.onToggle} style={S('background:none;border:none;padding:0;cursor:pointer;display:flex')}>
                        <Sym style={{ fontSize: 22, color: r.toggleColor }}>{r.toggleIcon}</Sym>
                      </button>
                    </div>
                    {r.key === 'meds' && r.on && (
                      <div style={S('display:flex;align-items:center;gap:8px;padding:2px 0 8px 29px')}>
                        <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#8C8474;flex-shrink:0")}>{t('Name')}</div>
                        <input type="text" value={v.medNameField} onChange={v.setMedName} placeholder={t('Vitamin D')} maxLength={40} style={S("flex:1;min-width:0;background:rgba(38,35,29,0.04);border:none;border-radius:12px;padding:7px 9px;font-size:13px;color:#26231D;outline:none;font-family:'Nunito',sans-serif;font-weight:600")} />
                      </div>
                    )}
                  </React.Fragment>
                ))}
                <div style={S('font-size:12px;color:#B5AC98;padding-top:8px;text-wrap:pretty')}>{t('Feeds are always on. Turning something off hides it for both of you — old entries stay, and it all comes back if you switch it on again.')}</div>
              </div>
              )}

              {v.canManage && (
              <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px 12px;margin-top:12px')}>
                <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;padding:10px 0 4px")}>{t('Units')}</div>
                <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0 4px;border-top:1px solid rgba(38,35,29,0.07)')}>
                  <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 250)' }}>local_drink</Sym>
                  <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Bottle & pump amounts')}</div>
                </div>
                <div style={S('display:flex;gap:8px;padding:2px 0 8px 29px')}>
                  {v.unitChips.map(u => (
                    <button key={u.key} type="button" onClick={u.onTap} className={u.on ? undefined : 'hov-bd'} style={S(`flex:1;height:34px;border-radius:999px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;background:${u.on ? 'rgba(var(--accent-rgb),0.16)' : 'var(--surface)'};border:1px solid ${u.on ? 'var(--accent)' : 'rgba(var(--ink-rgb),0.12)'};color:${u.on ? 'var(--accent-deep)' : 'var(--muted)'}`)}>{u.label}</button>
                  ))}
                </div>
                <div style={S('font-size:12px;color:#B5AC98;padding-top:6px;text-wrap:pretty')}>{t('Shared with your partner. The whole log converts either way — nothing to re-enter.')}</div>
              </div>
              )}

              <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px 12px;margin-top:12px')}>
                <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;padding:10px 0 4px")}>{t('Notifications')}</div>
                <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                  <Sym style={{ fontSize: 18, color: 'var(--accent)' }}>notifications_active</Sym>
                  <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Push to this phone')}</div>
                  {v.notify.supported && (
                    <button type="button" onClick={v.notify.togglePush} style={S('background:none;border:none;padding:0;cursor:pointer;display:flex')}>
                      <Sym style={{ fontSize: 22, color: v.notify.pushOn ? 'var(--accent)' : 'var(--dim)' }}>{v.notify.pushOn ? 'toggle_on' : 'toggle_off'}</Sym>
                    </button>
                  )}
                </div>
                <div style={S('font-size:12px;color:#B5AC98;padding:2px 0 4px;text-wrap:pretty')}>{v.notify.pushHint}</div>
                {v.notify.rows.map(r => (
                  <React.Fragment key={r.key}>
                    <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                      <Sym style={{ fontSize: 18, color: r.color }}>{r.icon}</Sym>
                      <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{r.label}</div>
                      {r.key === 'meds' && v.notify.medsOn && (
                        <input type="time" value={v.notify.medsTime} onChange={v.notify.setMedsTime} style={S("background:rgba(38,35,29,0.04);border:none;border-radius:12px;padding:7px 9px;font-size:13px;color:#26231D;outline:none;font-family:'Nunito',sans-serif;font-weight:600")} />
                      )}
                      <button type="button" onClick={r.onToggle} style={S('background:none;border:none;padding:0;cursor:pointer;display:flex')}>
                        <Sym style={{ fontSize: 22, color: r.toggleColor }}>{r.toggleIcon}</Sym>
                      </button>
                    </div>
                    {r.key === 'feed' && v.notify.feedOn && (
                      <>
                        {v.notify.feedChildRows ? v.notify.feedChildRows.map(cr => (
                          <div key={cr.id} style={S('display:flex;align-items:center;gap:7px;padding:2px 0 8px 29px;overflow:auto')}>
                            <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#8C8474;flex-shrink:0")}>{cr.name}</div>
                            {cr.chips.map((c, i) => (
                              <button key={i} type="button" onClick={c.onTap} style={S(`flex-shrink:0;background:${c.bg};border:1px solid ${c.border};border-radius:999px;padding:6px 11px;font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:${c.fg};cursor:pointer`)}>{c.label}</button>
                            ))}
                          </div>
                        )) : (
                        <div style={S('display:flex;align-items:center;gap:7px;padding:2px 0 8px 29px;overflow:auto')}>
                          <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#8C8474;flex-shrink:0")}>{t('Every')}</div>
                          {v.notify.feedChips.map((c, i) => (
                            <button key={i} type="button" onClick={c.onTap} style={S(`flex-shrink:0;background:${c.bg};border:1px solid ${c.border};border-radius:999px;padding:6px 11px;font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:${c.fg};cursor:pointer`)}>{c.label}</button>
                          ))}
                        </div>
                        )}
                        <div style={S('display:flex;align-items:center;gap:11px;padding:0 0 8px 29px')}>
                          <div style={S('flex:1;font-size:13px;color:#6E6659')}>{t('Only while I’m on duty')}</div>
                          <button type="button" onClick={v.notify.toggleOnDuty} style={S('background:none;border:none;padding:0;cursor:pointer;display:flex')}>
                            <Sym style={{ fontSize: 20, color: v.notify.onDutyToggleColor }}>{v.notify.onDutyToggleIcon}</Sym>
                          </button>
                        </div>
                      </>
                    )}
                    {r.key === 'quiet' && v.notify.quietOn && (
                      <div style={S('display:flex;align-items:center;gap:8px;padding:2px 0 8px 29px')}>
                        <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#8C8474")}>{t('From')}</div>
                        <input type="time" value={v.notify.quietStart} onChange={v.notify.setQuietStart} style={S("background:rgba(38,35,29,0.04);border:none;border-radius:12px;padding:7px 9px;font-size:13px;color:#26231D;outline:none;font-family:'Nunito',sans-serif;font-weight:600")} />
                        <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#8C8474")}>{t('to')}</div>
                        <input type="time" value={v.notify.quietEnd} onChange={v.notify.setQuietEnd} style={S("background:rgba(38,35,29,0.04);border:none;border-radius:12px;padding:7px 9px;font-size:13px;color:#26231D;outline:none;font-family:'Nunito',sans-serif;font-weight:600")} />
                      </div>
                    )}
                  </React.Fragment>
                ))}
                <div style={S('font-size:12px;color:#B5AC98;padding-top:8px;text-wrap:pretty')}>{t('Quiet hours pause reminders and activity pings — handoff asks always come through. Reminders reach every phone you’ve switched on.')}</div>
              </div>

              <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px 12px;margin-top:12px')}>
                <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;padding:10px 0 4px")}>{t('Share with your pediatrician')}</div>
                <div style={S('display:flex;gap:6px;padding:4px 0 10px')}>
                  {v.exportRanges.map((u, i) => (
                    <button key={i} type="button" onClick={u.onTap} style={S(`flex:1;background:${u.bg};border:1px solid ${u.border};border-radius:999px;padding:8px 6px;font-family:inherit;font-size:12.5px;font-weight:600;color:${u.fg};cursor:pointer`)}>{u.label}</button>
                  ))}
                </div>
                <button type="button" onClick={v.exportSummary} className="hov-row" style={S('width:100%;background:none;border:none;display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07);cursor:pointer;font-family:inherit;text-align:left;border-radius:10px')}>
                  <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 130)' }}>calendar_month</Sym>
                  <div style={S('flex:1;min-width:0')}>
                    <div style={S('font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Daily summary')}</div>
                    <div style={S('font-size:11.5px;color:#B5AC98;padding-top:1px')}>{t('Feeds, {units}, diapers & sleep per day', { units: v.unitWord })}</div>
                  </div>
                  <Sym style={{ fontSize: 18, color: 'var(--dim)' }}>ios_share</Sym>
                </button>
                <button type="button" onClick={v.exportLog} className="hov-row" style={S('width:100%;background:none;border:none;display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07);cursor:pointer;font-family:inherit;text-align:left;border-radius:10px')}>
                  <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 250)' }}>table_view</Sym>
                  <div style={S('flex:1;min-width:0')}>
                    <div style={S('font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Full log')}</div>
                    <div style={S('font-size:11.5px;color:#B5AC98;padding-top:1px')}>{t('Every entry, spreadsheet-ready')}</div>
                  </div>
                  <Sym style={{ fontSize: 18, color: 'var(--dim)' }}>ios_share</Sym>
                </button>
                <div style={S('font-size:12px;color:#B5AC98;padding-top:6px;text-wrap:pretty')}>{t('Opens your phone’s share sheet as a CSV — send it by email or message.')}</div>
              </div>

              <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px 12px;margin-top:12px')}>
                <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;padding:10px 0 4px")}>{t('Bring your history over')}</div>
                <label className="hov-row" style={S('width:100%;box-sizing:border-box;background:none;border:none;display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07);cursor:pointer;font-family:inherit;text-align:left;border-radius:10px')}>
                  <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 300)' }}>child_care</Sym>
                  <div style={S('flex:1;min-width:0')}>
                    <div style={S('font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Import from Baby Buddy')}</div>
                    <div style={S('font-size:11.5px;color:#B5AC98;padding-top:1px')}>{t(v.importBusy ? 'Importing…' : 'Feedings, pumping, diapers & sleep CSVs')}</div>
                  </div>
                  <Sym style={{ fontSize: 18, color: 'var(--dim)' }}>upload_file</Sym>
                  <input type="file" accept=".csv,text/csv" multiple onChange={v.importBB} style={S('display:none')} />
                </label>
                <div style={S('font-size:12px;color:#B5AC98;padding-top:6px;text-wrap:pretty')}>{t('Pick the CSV files Baby Buddy exports (one per type) — you can select several at once, and importing the same file twice won’t duplicate anything.')}</div>
              </div>

              <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px 12px;margin-top:12px')}>
                <button type="button" onClick={v.apiAccess.toggle} className="hov-row" style={S('width:100%;background:none;border:none;display:flex;align-items:center;gap:11px;padding:9px 0;cursor:pointer;font-family:inherit;text-align:left;border-radius:10px')}>
                  <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 40)' }}>key</Sym>
                  <div style={S('flex:1;min-width:0')}>
                    <div style={S('font-size:14px;font-weight:600;color:#4E4A3F')}>{t('API access')}</div>
                    <div style={S('font-size:11.5px;color:#B5AC98;padding-top:1px')}>{t('Tokens for other apps and AI assistants')}</div>
                  </div>
                  <Sym style={{ fontSize: 18, color: 'var(--dim)' }}>{v.apiAccess.open ? 'expand_less' : 'expand_more'}</Sym>
                </button>
                {v.apiAccess.open && (
                  <>
                    {!v.apiAccess.loaded && (
                      <div style={S('font-size:12px;color:#B5AC98;padding:6px 0 4px 29px')}>{t('One sec…')}</div>
                    )}
                    {v.apiAccess.loaded && !v.apiAccess.rows.length && (
                      <div style={S('font-size:12px;color:#B5AC98;padding:6px 0 4px 29px;text-wrap:pretty')}>{t('Nothing yet — make a token and other apps can read or write this log as you.')}</div>
                    )}
                    {v.apiAccess.rows.map(tok => (
                      <div key={tok.id} style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                        <Sym style={{ fontSize: 18, color: 'var(--soft)' }}>vpn_key</Sym>
                        <div style={S('flex:1;min-width:0')}>
                          <div style={S('font-size:14px;font-weight:600;color:#4E4A3F;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{tok.name}</div>
                          <div style={S('font-size:11.5px;color:#B5AC98;padding-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{tok.scopeText}</div>
                          <div style={S('font-size:11.5px;color:#B5AC98;padding-top:1px')}>{tok.hint}</div>
                        </div>
                        {!tok.armed && (
                          <button type="button" onClick={tok.arm} className="hov-bd" style={S("flex-shrink:0;background:none;border:1px solid rgba(38,35,29,0.14);border-radius:999px;padding:6px 12px;font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;color:#A85A45;cursor:pointer")}>{t('Revoke')}</button>
                        )}
                        {tok.armed && (
                          <>
                            <button type="button" onClick={tok.revoke} style={S("flex-shrink:0;background:#A85A45;border:none;border-radius:999px;padding:7px 12px;font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;color:#FCFBF6;cursor:pointer")}>{t('Yes, revoke')}</button>
                            <button type="button" onClick={tok.disarm} className="hov-bd" style={S("flex-shrink:0;background:none;border:1px solid rgba(38,35,29,0.14);border-radius:999px;padding:6px 12px;font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;color:#8C8474;cursor:pointer")}>{t('Keep')}</button>
                          </>
                        )}
                      </div>
                    ))}
                    {v.apiAccess.newToken && (
                      <div style={S('display:flex;flex-direction:column;gap:6px;padding:9px 0 10px 29px;border-top:1px solid rgba(38,35,29,0.07)')}>
                        <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#8C8474")}>{t('Your new token')}</div>
                        <div style={S("font-family:'Nunito',sans-serif;font-weight:800;font-size:13px;letter-spacing:0.02em;color:#26231D;word-break:break-all")}>{v.apiAccess.newToken}</div>
                        <div>
                          <button type="button" onClick={v.apiAccess.copyNew} className="hov-bd" style={S("background:none;border:1px solid rgba(38,35,29,0.14);border-radius:999px;padding:5px 11px;font-family:'Nunito',sans-serif;font-weight:600;font-size:10.5px;color:#8C8474;cursor:pointer")}>{t('Copy')}</button>
                        </div>
                        <div style={S('font-size:11.5px;color:#B5AC98;text-wrap:pretty')}>{t('You won’t see this again — copy it now.')}</div>
                      </div>
                    )}
                    {v.apiAccess.loaded && (
                      <>
                        <button type="button" onClick={v.apiAccess.toggleAdd} className="hov-row" style={S('width:100%;background:none;border:none;display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07);cursor:pointer;font-family:inherit;text-align:left;border-radius:10px')}>
                          <Sym style={{ fontSize: 18, color: 'var(--accent)' }}>add_circle</Sym>
                          <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{t('New token')}</div>
                          <Sym style={{ fontSize: 18, color: 'var(--dim)' }}>{v.apiAccess.addOpen ? 'expand_less' : 'expand_more'}</Sym>
                        </button>
                        {v.apiAccess.addOpen && (
                          <div style={S('display:flex;flex-direction:column;gap:8px;padding:2px 0 10px 29px')}>
                            <input placeholder={t('What’s it for? — Home Assistant, Claude…')} value={v.apiAccess.name} onChange={v.apiAccess.setName} maxLength={40} style={S('width:100%;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;padding:11px 16px;font-size:14.5px;color:#26231D;outline:none')} />
                            <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#8C8474")}>{t('What it may do')}</div>
                            <div style={S('display:flex;flex-wrap:wrap;gap:6px')}>
                              {v.apiAccess.scopeChips.map(c => (
                                <button key={c.key} type="button" onClick={c.onTap} style={S(`background:${c.bg};border:1px solid ${c.border};border-radius:999px;padding:7px 12px;font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:${c.fg};cursor:pointer;text-align:left`)}>{c.label}</button>
                              ))}
                            </div>
                            <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#8C8474")}>{t('Expires')}</div>
                            <div style={S('display:flex;gap:6px')}>
                              {v.apiAccess.expiryChips.map(c => (
                                <button key={c.key} type="button" onClick={c.onTap} style={S(`flex:1;background:${c.bg};border:1px solid ${c.border};border-radius:999px;padding:8px 6px;font-family:inherit;font-size:12.5px;font-weight:600;color:${c.fg};cursor:pointer`)}>{c.label}</button>
                              ))}
                            </div>
                            {v.apiAccess.error && (
                              <div style={S('font-size:12.5px;line-height:1.4;color:#A85A45;text-wrap:pretty')}>{v.apiAccess.error}</div>
                            )}
                            <button type="button" onClick={v.apiAccess.submit} disabled={!v.apiAccess.canCreate} className="hov-olive" style={S(`align-self:flex-start;height:42px;padding:0 18px;background:var(--accent);border:none;border-radius:999px;cursor:pointer;font-family:inherit;font-size:13.5px;font-weight:700;color:#FCFBF6;opacity:${v.apiAccess.canCreate ? '1' : '0.5'}`)}>{v.apiAccess.busy ? t('One sec…') : t('Create token')}</button>
                            <div style={S('font-size:11.5px;color:#B5AC98;text-wrap:pretty')}>{t('It can only do what you tick here — and only as your account.')}</div>
                          </div>
                        )}
                      </>
                    )}
                    {!v.apiAccess.addOpen && v.apiAccess.error && (
                      <div style={S('font-size:12.5px;line-height:1.4;color:#A85A45;padding:2px 0 4px 29px;text-wrap:pretty')}>{v.apiAccess.error}</div>
                    )}
                  </>
                )}
                <div style={S('font-size:12px;color:#B5AC98;padding-top:6px;text-wrap:pretty')}>{t('Tokens let other apps — scripts, Home Assistant, AI assistants over MCP — use this log as you. Revoking one stops it right away.')}</div>
              </div>

              {v.canManage && (
              <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px 12px;margin-top:12px')}>
                <button type="button" onClick={v.mqtt.toggle} className="hov-row" style={S('width:100%;background:none;border:none;display:flex;align-items:center;gap:11px;padding:9px 0;cursor:pointer;font-family:inherit;text-align:left;border-radius:10px')}>
                  <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 170)' }}>home_iot_device</Sym>
                  <div style={S('flex:1;min-width:0')}>
                    <div style={S('font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Home Assistant')}</div>
                    <div style={S('font-size:11.5px;color:#B5AC98;padding-top:1px')}>{v.mqtt.hint}</div>
                  </div>
                  <Sym style={{ fontSize: 18, color: 'var(--dim)' }}>{v.mqtt.open ? 'expand_less' : 'expand_more'}</Sym>
                </button>
                {v.mqtt.open && !v.mqtt.loaded && !v.mqtt.error && (
                  <div style={S('font-size:12px;color:#B5AC98;padding:6px 0 4px 29px')}>{t('One sec…')}</div>
                )}
                {v.mqtt.open && !v.mqtt.loaded && v.mqtt.error && (
                  <div style={S('font-size:12.5px;line-height:1.4;color:#A85A45;padding:2px 0 4px 29px;text-wrap:pretty')}>{v.mqtt.error}</div>
                )}
                {v.mqtt.open && v.mqtt.loaded && (
                  <>
                    <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                      <Sym style={{ fontSize: 18, color: 'var(--accent)' }}>sync</Sym>
                      <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Publish to MQTT')}</div>
                      <button type="button" onClick={v.mqtt.toggleEnabled} style={S('background:none;border:none;padding:0;cursor:pointer;display:flex')}>
                        <Sym style={{ fontSize: 22, color: v.mqtt.enabled ? 'var(--accent)' : 'var(--dim)' }}>{v.mqtt.enabled ? 'toggle_on' : 'toggle_off'}</Sym>
                      </button>
                    </div>
                    <div style={S('display:flex;flex-direction:column;gap:8px;padding:2px 0 10px 29px')}>
                      <input placeholder={t('Host')} value={v.mqtt.host} onChange={v.mqtt.setHost} style={S('width:100%;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;padding:11px 16px;font-size:14.5px;color:#26231D;outline:none')} />
                      <input placeholder={t('Port')} type="number" value={v.mqtt.port} onChange={v.mqtt.setPort} style={S('width:100%;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;padding:11px 16px;font-size:14.5px;color:#26231D;outline:none')} />
                      <input placeholder={t('Username')} value={v.mqtt.username} onChange={v.mqtt.setUsername} autoComplete="off" style={S('width:100%;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;padding:11px 16px;font-size:14.5px;color:#26231D;outline:none')} />
                      <input placeholder={v.mqtt.pwPlaceholder} type="password" value={v.mqtt.password} onChange={v.mqtt.setPassword} autoComplete="new-password" style={S('width:100%;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;padding:11px 16px;font-size:14.5px;color:#26231D;outline:none')} />
                      <div style={S('display:flex;align-items:center;gap:11px;padding:2px 0')}>
                        <div style={S('flex:1;font-size:13px;color:#6E6659')}>{t('Use TLS')}</div>
                        <button type="button" onClick={v.mqtt.toggleTls} style={S('background:none;border:none;padding:0;cursor:pointer;display:flex')}>
                          <Sym style={{ fontSize: 20, color: v.mqtt.tls ? 'var(--accent)' : 'var(--dim)' }}>{v.mqtt.tls ? 'toggle_on' : 'toggle_off'}</Sym>
                        </button>
                      </div>
                      {v.mqtt.tls && (
                        <div style={S('display:flex;align-items:center;gap:11px;padding:2px 0')}>
                          <div style={S('flex:1;font-size:13px;color:#6E6659')}>{t('Verify certificate')}</div>
                          <button type="button" onClick={v.mqtt.toggleTlsVerify} style={S('background:none;border:none;padding:0;cursor:pointer;display:flex')}>
                            <Sym style={{ fontSize: 20, color: v.mqtt.tlsVerify ? 'var(--accent)' : 'var(--dim)' }}>{v.mqtt.tlsVerify ? 'toggle_on' : 'toggle_off'}</Sym>
                          </button>
                        </div>
                      )}
                      {v.mqtt.testResult?.ok && (
                        <div style={S('font-size:12.5px;line-height:1.4;font-weight:600;color:oklch(0.60 0.075 145)')}>{t('Connected ✓')}</div>
                      )}
                      {v.mqtt.testResult && !v.mqtt.testResult.ok && (
                        <div style={S('font-size:12.5px;line-height:1.4;color:#A85A45;text-wrap:pretty')}>{v.mqtt.testResult.message}</div>
                      )}
                      {v.mqtt.error && (
                        <div style={S('font-size:12.5px;line-height:1.4;color:#A85A45;text-wrap:pretty')}>{v.mqtt.error}</div>
                      )}
                      <div style={S('display:flex;gap:8px')}>
                        <button type="button" onClick={v.mqtt.test} disabled={v.mqtt.busy} className="hov-bd" style={S(`height:42px;padding:0 18px;background:none;border:1px solid rgba(38,35,29,0.14);border-radius:999px;cursor:pointer;font-family:inherit;font-size:13.5px;font-weight:700;color:#8C8474;opacity:${v.mqtt.busy ? '0.5' : '1'}`)}>{t('Test connection')}</button>
                        <button type="button" onClick={v.mqtt.save} disabled={v.mqtt.busy} className="hov-olive" style={S(`height:42px;padding:0 18px;background:var(--accent);border:none;border-radius:999px;cursor:pointer;font-family:inherit;font-size:13.5px;font-weight:700;color:#FCFBF6;opacity:${v.mqtt.busy ? '0.5' : '1'}`)}>{v.mqtt.busy ? t('One sec…') : t('Save')}</button>
                      </div>
                    </div>
                  </>
                )}
                <div style={S('font-size:12px;color:#B5AC98;padding-top:6px;text-wrap:pretty')}>{t('Publishes to your MQTT broker so Home Assistant discovers sensors and buttons. See docs/home-assistant.md.')}</div>
              </div>
              )}

              <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px 12px;margin-top:12px')}>
                <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;padding:10px 0 4px")}>{t('Your account')}</div>
                <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                  <Sym style={{ fontSize: 18, color: 'var(--accent)' }}>badge</Sym>
                  <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Your name')}</div>
                  <input value={v.account.name} onChange={v.account.setName} onBlur={v.account.saveName} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} placeholder={t('Parent')} style={S("width:140px;box-sizing:border-box;text-align:right;background:rgba(38,35,29,0.04);border:none;border-radius:12px;padding:8px 10px;font-size:13.5px;color:#26231D;outline:none;font-family:'Nunito',sans-serif;font-weight:600")} />
                </div>
                <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                  <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 250)' }}>alternate_email</Sym>
                  <div style={S('flex:1;min-width:0')}>
                    <div style={S('font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Email')}</div>
                    <div style={S('font-size:11.5px;color:#B5AC98;padding-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{v.account.email || '—'}</div>
                  </div>
                  <button type="button" onClick={() => v.account.toggle('email')} className="hov-bd" style={S("flex-shrink:0;background:none;border:1px solid rgba(38,35,29,0.14);border-radius:999px;padding:6px 12px;font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;color:#8C8474;cursor:pointer")}>{t(v.account.open === 'email' ? 'Cancel' : 'Change')}</button>
                </div>
                {v.account.open === 'email' && (
                  <div style={S('display:flex;flex-direction:column;gap:8px;padding:2px 0 10px 29px')}>
                    <input placeholder={t('New email')} type="email" value={v.account.emailField} onChange={v.account.setEmailField} style={S('width:100%;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;padding:11px 16px;font-size:14.5px;color:#26231D;outline:none')} />
                    <input placeholder={t('Current password')} type="password" value={v.account.emailPw} onChange={v.account.setEmailPw} style={S('width:100%;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;padding:11px 16px;font-size:14.5px;color:#26231D;outline:none')} />
                    {v.account.error && (
                      <div style={S('font-size:12.5px;line-height:1.4;color:#A85A45;text-wrap:pretty')}>{v.account.error}</div>
                    )}
                    <button type="button" onClick={v.account.submitEmail} className="hov-olive" style={S('align-self:flex-start;height:42px;padding:0 18px;background:var(--accent);border:none;border-radius:999px;cursor:pointer;font-family:inherit;font-size:13.5px;font-weight:700;color:#FCFBF6')}>{v.account.busy ? t('One sec…') : t('Save email')}</button>
                    <div style={S('font-size:11.5px;color:#B5AC98;text-wrap:pretty')}>{t('You’ll log in with the new address from now on — this phone stays signed in.')}</div>
                  </div>
                )}
                <div style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                  <Sym style={{ fontSize: 18, color: 'oklch(0.60 0.075 300)' }}>key</Sym>
                  <div style={S('flex:1;font-size:14px;font-weight:600;color:#4E4A3F')}>{t('Password')}</div>
                  <button type="button" onClick={() => v.account.toggle('password')} className="hov-bd" style={S("flex-shrink:0;background:none;border:1px solid rgba(38,35,29,0.14);border-radius:999px;padding:6px 12px;font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;color:#8C8474;cursor:pointer")}>{t(v.account.open === 'password' ? 'Cancel' : 'Change')}</button>
                </div>
                {v.account.open === 'password' && (
                  <div style={S('display:flex;flex-direction:column;gap:8px;padding:2px 0 10px 29px')}>
                    <input placeholder={t('Current password')} type="password" value={v.account.pwCur} onChange={v.account.setPwCur} style={S('width:100%;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;padding:11px 16px;font-size:14.5px;color:#26231D;outline:none')} />
                    <input placeholder={t('New password — 8+ characters')} type="password" value={v.account.pwNew} onChange={v.account.setPwNew} style={S('width:100%;box-sizing:border-box;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;padding:11px 16px;font-size:14.5px;color:#26231D;outline:none')} />
                    {v.account.error && (
                      <div style={S('font-size:12.5px;line-height:1.4;color:#A85A45;text-wrap:pretty')}>{v.account.error}</div>
                    )}
                    <button type="button" onClick={v.account.submitPassword} className="hov-olive" style={S('align-self:flex-start;height:42px;padding:0 18px;background:var(--accent);border:none;border-radius:999px;cursor:pointer;font-family:inherit;font-size:13.5px;font-weight:700;color:#FCFBF6')}>{v.account.busy ? t('One sec…') : t('Save password')}</button>
                    <div style={S('font-size:11.5px;color:#B5AC98;text-wrap:pretty')}>{t('Every other phone gets logged out — this one stays signed in.')}</div>
                  </div>
                )}
                <div style={S('font-size:12px;color:#B5AC98;padding-top:6px;text-wrap:pretty')}>{t('Your name is what your partner sees on duty and handoffs.')}</div>
              </div>

              <div style={S('text-align:center;padding:16px 0 0')}>
                <button type="button" onClick={v.logout} className="hov-bd" style={S("background:none;border:1px solid rgba(38,35,29,0.14);border-radius:999px;padding:8px 15px;font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;color:#8C8474;cursor:pointer")}>{t('Log out')}</button>
              </div>

              {/* the AGPL's network clause: everyone using this instance gets an
                  offer of the source it's running. Deliberately the last thing
                  on the last screen — present, never in the way. */}
              <div style={S('text-align:center;padding:22px 0 0;display:flex;flex-direction:column;align-items:center;gap:6px')}>
                <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className="hov-bd" style={S("background:none;border:1px solid rgba(38,35,29,0.14);border-radius:999px;padding:8px 15px;font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;color:#8C8474;text-decoration:none;display:inline-flex;align-items:center;gap:6px")}>
                  <Sym style={{ fontSize: 14, color: 'var(--soft)' }}>code</Sym>
                  {t('Source code')}
                </a>
                <div style={S('font-size:11px;color:#B5AC98;text-wrap:pretty;max-width:280px;line-height:1.45')}>{t('Free software under the AGPL-3.0 — read it, change it, run your own.')}</div>
              </div>
            </div>
          </div>
        )}

        {v.showTabs && (
          <>
            <div style={S('padding:6px 18px 0;display:flex;align-items:center;gap:10px;position:relative;z-index:1')}>
              <button type="button" onClick={v.goHome} className="hov-cream" style={S(`height:56px;flex:1;background:${v.homeTabBg};border:1px solid rgba(38,35,29,0.10);border-radius:999px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;font-family:inherit`)}>
                <Sym style={{ fontSize: 20, color: v.homeTabFg }}>schedule</Sym>
                <div style={S(`font-size:11px;font-weight:600;color:${v.homeTabFg};letter-spacing:0.01em`)}>{t('Now')}</div>
              </button>
              <button type="button" onClick={v.openSheet} className="hov-olive" style={S('width:68px;height:68px;background:var(--accent);border:none;border-radius:999px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 8px 20px rgba(var(--accent-rgb),0.34);margin-bottom:6px')}>
                <Sym style={{ fontSize: 32, color: 'var(--on-accent)' }}>add</Sym>
              </button>
              <button type="button" onClick={v.goHistory} className="hov-cream" style={S(`height:56px;flex:1;background:${v.histTabBg};border:1px solid rgba(38,35,29,0.10);border-radius:999px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;font-family:inherit`)}>
                <Sym style={{ fontSize: 20, color: v.histTabFg }}>bar_chart</Sym>
                <div style={S(`font-size:11px;font-weight:600;color:${v.histTabFg};letter-spacing:0.01em`)}>{t('History')}</div>
              </button>
            </div>
          </>
        )}

        {v.toast && (
          <div className="toast-in" style={{
            ...S('position:absolute;left:16px;right:16px;bottom:126px;background:#26231D;border-radius:999px;padding:11px 10px 11px 18px;display:flex;align-items:center;gap:12px;box-shadow:0 10px 30px rgba(0,0,0,0.25);z-index:30;transition:opacity 0.22s ease'),
            opacity: v.toastLeaving ? 0 : 1,
            pointerEvents: v.toastLeaving ? 'none' : 'auto',
          }}>
            <div style={S('flex:1;min-width:0;font-size:14px;color:#FAF6EF')}>{v.toastText}</div>
            {v.canUndo && <button type="button" onClick={v.undo} style={S("background:rgba(250,246,239,0.16);border:none;border-radius:999px;padding:7px 14px;font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;color:#FAF6EF;cursor:pointer")}>{t('Undo')}</button>}
          </div>
        )}

        {v.sheetMounted && (
          <div style={{ ...S('position:absolute;inset:0;z-index:40'), pointerEvents: v.sheetShown ? 'auto' : 'none' }}>
            <div onClick={v.closeSheet} style={{ ...S('position:absolute;inset:0;background:rgba(30,27,20,0.42);backdrop-filter:blur(2px);transition:opacity 0.3s ease'), opacity: v.sheetShown ? 1 : 0 }} />
            <div style={{
              ...S('position:absolute;left:0;right:0;bottom:0;background:#FAF6EF;border-radius:34px 34px 0 0;padding:10px 16px 22px;box-shadow:0 -12px 40px rgba(0,0,0,0.18);overflow:hidden;max-height:92vh;display:flex;flex-direction:column'),
              height: v.sheetTall ? '86vh' : 'auto',
              transform: v.sheetShown ? `translateY(${v.sheetTranslate}px)` : 'translateY(105%)',
              transition: v.sheetDragging ? 'none' : 'transform 0.34s cubic-bezier(0.32,0.72,0,1)',
            }}>
              <div style={S('position:absolute;inset:0;z-index:0')}>
                <img className="bg-art" src={sheetBgArt} alt="" style={S('width:100%;height:100%;object-fit:cover;display:block')} />
                <div className="bg-wash" style={S('position:absolute;inset:0;background:rgba(250,246,239,0.7);pointer-events:none')} />
              </div>
              <div onPointerDown={v.sheetGrab.start} onPointerMove={v.sheetGrab.move} onPointerUp={v.sheetGrab.end} onPointerCancel={v.sheetGrab.end}
                style={S('position:relative;z-index:1;flex-shrink:0;padding:13px 0 13px;margin:-10px -16px 0;cursor:grab;touch-action:none')}>
                <div style={S('width:38px;height:4px;border-radius:99px;background:rgba(38,35,29,0.16);margin:0 auto')} />
              </div>
              <div onPointerDown={v.sheetGrab.bodyDown} onPointerMove={v.sheetGrab.bodyMove} onPointerUp={v.sheetGrab.bodyUp} onPointerCancel={v.sheetGrab.bodyUp}
                style={S('position:relative;z-index:1;flex:1;min-height:0;overflow:auto;touch-action:pan-y;overscroll-behavior:contain')}>

                {v.sheetChildren && (
                  <div style={S('display:flex;align-items:center;gap:8px;padding:0 4px 12px;overflow:auto')}>
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#8C8474;flex-shrink:0;padding-right:2px")}>{t('For')}</div>
                    {v.sheetChildren.map(c => (
                      <button key={c.id} type="button" onClick={c.onTap} style={S(`flex-shrink:0;background:${c.bg};border:1px solid ${c.border};border-radius:999px;padding:7px 12px;font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:${c.fg};cursor:pointer`)}>{c.label}</button>
                    ))}
                  </div>
                )}

                {v.showStamp && (
                <div style={S('display:flex;align-items:flex-end;justify-content:space-between;padding:0 4px 12px')}>
                  <label style={S('position:relative;display:flex;flex-direction:column;gap:3px;cursor:pointer')}>
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#8C8474")}>{v.sheetKicker}</div>
                    <div style={S('display:flex;align-items:baseline;gap:7px')}>
                      <div style={S("font-family:'Nunito',sans-serif;font-size:31px;font-weight:700;letter-spacing:-0.04em")}>{v.stampTime}</div>
                      <Sym style={{ fontSize: 15, color: 'var(--faint)' }}>edit</Sym>
                    </div>
                    <input type="time" value={v.stampHM} onChange={v.pickTime} onClick={v.showPicker} style={S('position:absolute;inset:0;width:100%;height:100%;opacity:0;border:0;padding:0;margin:0;cursor:pointer')} />
                  </label>
                  <div style={S('display:flex;gap:6px;padding-bottom:6px')}>
                    {v.nudges.map((n, i) => (
                      <button key={i} type="button" onClick={n.onTap} style={S(`background:${n.bg};border:1px solid ${n.border};border-radius:999px;padding:7px 11px;font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;color:${n.fg};cursor:pointer;letter-spacing:-0.01em`)}>{n.label}</button>
                    ))}
                  </div>
                </div>
                )}
                {v.timerFirst && (
                  <div style={S('padding:2px 4px 12px')}>
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#8C8474")}>{t('Time it live')}</div>
                    <div style={S('font-size:13px;color:#6E6659;padding-top:3px;text-wrap:pretty')}>{t('Hit start, and stop when you’re done — the duration logs itself.')}</div>
                  </div>
                )}

                <div style={S('display:grid;grid-template-columns:1fr 1fr 1fr;gap:9px')}>
                  {v.types.map(ty => (
                    <button key={ty.label} type="button" onClick={ty.onTap} className="hov-bd" style={S('position:relative;background:#FFFDF8;border:1px solid rgba(38,35,29,0.08);border-radius:24px;padding:12px 8px 12px;display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;font-family:inherit;overflow:hidden')}>
                      <div style={S(`position:absolute;inset:0;opacity:${ty.tint};background:${ty.color}`)} />
                      {ty.on && (
                        <div style={S(`position:absolute;inset:0;border-radius:23px;box-shadow:inset 0 0 0 2.5px ${ty.color}`)} />
                      )}
                      <div style={S('position:relative;width:48px;height:48px;border-radius:999px;display:flex;align-items:center;justify-content:center;overflow:hidden')}>
                        <div style={S(`position:absolute;inset:0;background:${ty.color};opacity:0.16`)} />
                        <Sym style={{ position: 'relative', fontSize: 26, color: ty.color }}>{ty.icon}</Sym>
                      </div>
                      <div style={S('position:relative;font-size:13px;font-weight:600;letter-spacing:-0.01em;color:#3D392F')}>{ty.label}</div>
                    </button>
                  ))}
                </div>

                {v.hasDetail && (
                  <div style={S('display:flex;align-items:center;gap:8px;padding:14px 2px 0;overflow:auto')}>
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#8C8474;flex-shrink:0;padding-right:2px")}>{v.detailLabel}</div>
                    {v.detailOptions.map((d, i) => d.scrub ? (
                      <button key={i} type="button" onPointerDown={d.onDown} onPointerMove={v.scrubMove} onPointerUp={v.scrubEnd} onPointerCancel={v.scrubEnd}
                        style={S(`flex-shrink:0;display:flex;align-items:center;gap:3px;background:${d.bg};border:1px solid ${d.border};border-radius:999px;padding:8px 13px;font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:${d.fg};cursor:ns-resize;touch-action:pan-x;user-select:none`)}>
                        {d.label}
                        {d.on && <Sym style={{ fontSize: 12, color: d.fg, opacity: 0.7 }}>unfold_more</Sym>}
                      </button>
                    ) : (
                      <button key={i} type="button" onClick={d.onTap} style={S(`flex-shrink:0;background:${d.bg};border:1px solid ${d.border};border-radius:999px;padding:8px 13px;font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:${d.fg};cursor:pointer`)}>{d.label}</button>
                    ))}
                  </div>
                )}

                {v.hasDetail2 && (
                  <div style={S('display:flex;align-items:center;gap:8px;padding:10px 2px 0;overflow:auto')}>
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#8C8474;flex-shrink:0;padding-right:2px")}>{v.detail2Label}</div>
                    {v.detail2Options.map((d, i) => d.scrub ? (
                      <button key={i} type="button" onPointerDown={d.onDown} onPointerMove={v.scrubMove} onPointerUp={v.scrubEnd} onPointerCancel={v.scrubEnd}
                        style={S(`flex-shrink:0;display:flex;align-items:center;gap:3px;background:${d.bg};border:1px solid ${d.border};border-radius:999px;padding:8px 13px;font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:${d.fg};cursor:ns-resize;touch-action:pan-x;user-select:none`)}>
                        {d.label}
                        {d.on && <Sym style={{ fontSize: 12, color: d.fg, opacity: 0.7 }}>unfold_more</Sym>}
                      </button>
                    ) : (
                      <button key={i} type="button" onClick={d.onTap} style={S(`flex-shrink:0;background:${d.bg};border:1px solid ${d.border};border-radius:999px;padding:8px 13px;font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:${d.fg};cursor:pointer`)}>{d.label}</button>
                    ))}
                  </div>
                )}

                {/* Advanced: the day, and a plain reading of what will be
                    saved. Sits above the button because it's a field, not an
                    afterthought — the link that opens it is down by Cancel */}
                {v.advancedOpen && (
                  <div style={S('margin-top:14px;padding-top:12px;border-top:1px solid rgba(38,35,29,0.08)')}>
                    <div style={S('display:flex;align-items:center;gap:8px;padding:0 2px;overflow:auto')}>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#8C8474;flex-shrink:0;padding-right:2px")}>{t('Day')}</div>
                      {v.dayChips.map((d, i) => (
                        <button key={i} type="button" onClick={d.onTap} style={S(`flex-shrink:0;background:${d.bg};border:1px solid ${d.border};border-radius:999px;padding:8px 13px;font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:${d.fg};cursor:pointer`)}>{d.label}</button>
                      ))}
                      <label style={S(`position:relative;flex-shrink:0;display:flex;align-items:center;gap:4px;background:${v.dateChip.bg};border:1px solid ${v.dateChip.border};border-radius:999px;padding:8px 13px;font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:${v.dateChip.fg};cursor:pointer`)}>
                        <Sym style={{ fontSize: 14, color: v.dateChip.fg }}>calendar_month</Sym>
                        {v.dateChip.label}
                        <input type="date" value={v.dateValue} max={v.dateMax} onChange={v.pickDate} onClick={v.showPicker} style={S('position:absolute;inset:0;width:100%;height:100%;opacity:0;border:0;padding:0;margin:0;cursor:pointer')} />
                      </label>
                    </div>
                    <div style={S('padding:10px 3px 0;font-size:12px;color:#8C8474;letter-spacing:-0.01em')}>{v.stampFull}</div>
                  </div>
                )}

                {v.timerFirst ? (
                  <button type="button" onClick={v.startTimer} className="hov-olive" style={S('margin-top:16px;width:100%;height:66px;background:var(--accent);border:none;border-radius:999px;display:flex;align-items:center;justify-content:center;gap:10px;cursor:pointer;font-family:inherit;box-shadow:0 6px 18px rgba(var(--accent-rgb),0.3)')}>
                    <Sym style={{ fontSize: 23, color: 'var(--on-accent)' }}>play_arrow</Sym>
                    <div style={S('font-size:17px;font-weight:600;color:#FCFBF6;letter-spacing:-0.01em')}>{v.startTimerLabel}</div>
                  </button>
                ) : (
                  <button type="button" onClick={v.save} className="hov-olive" style={S('margin-top:16px;width:100%;height:66px;background:var(--accent);border:none;border-radius:999px;display:flex;align-items:center;justify-content:center;gap:10px;cursor:pointer;font-family:inherit;box-shadow:0 6px 18px rgba(var(--accent-rgb),0.3)')}>
                    <Sym style={{ fontSize: 23, color: 'var(--on-accent)' }}>check</Sym>
                    <div style={S('font-size:17px;font-weight:600;color:#FCFBF6;letter-spacing:-0.01em')}>{v.saveLabel}</div>
                  </button>
                )}

                <div style={S('display:flex;align-items:center;justify-content:space-between;padding:12px 6px 0')}>
                  <button type="button" onClick={v.closeSheet} style={S("background:none;border:none;font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;color:#8C8474;cursor:pointer")}>{t('Cancel')}</button>
                  {v.canManual && (
                    <button type="button" onClick={v.timerFirst ? v.toManual : v.toTimer} style={S("background:none;border:none;font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;color:#5F6E42;cursor:pointer")}>{v.timerFirst ? v.manualHint : t('Use a timer')}</button>
                  )}
                  {v.editing && (
                    <button type="button" onClick={v.remove} style={S("background:none;border:none;font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;color:#A85A45;cursor:pointer")}>{t('Delete entry')}</button>
                  )}
                  {v.canAdvanced && (
                    <button type="button" onClick={v.toggleAdvanced} aria-expanded={v.advancedOpen} style={S("display:flex;align-items:center;gap:2px;background:none;border:none;font-family:'Nunito',sans-serif;font-weight:600;font-size:11px;color:#8C8474;cursor:pointer;padding:0")}>
                      {t('Advanced')}
                      {/* matches the label's #8C8474, which S() rewrites — a JS style object doesn't go through it */}
                      <Sym style={{ fontSize: 14, color: 'var(--soft)' }}>{v.advancedOpen ? 'expand_less' : 'expand_more'}</Sym>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {v.shiftMounted && (
          <div style={{ ...S('position:absolute;inset:0;z-index:50'), pointerEvents: v.shiftShown ? 'auto' : 'none' }}>
            <div onClick={v.closeShift} style={{ ...S('position:absolute;inset:0;background:rgba(30,27,20,0.42);backdrop-filter:blur(2px);transition:opacity 0.3s ease'), opacity: v.shiftShown ? 1 : 0 }} />
            <div style={{
              ...S('position:absolute;left:0;right:0;bottom:0;background:#FAF6EF;border-radius:34px 34px 0 0;padding:10px 16px 22px;box-shadow:0 -12px 40px rgba(0,0,0,0.18);max-height:min(760px, 88dvh);overflow:hidden;display:flex;flex-direction:column'),
              transform: v.shiftShown ? `translateY(${v.shiftTranslate}px)` : 'translateY(105%)',
              transition: v.shiftDragging ? 'none' : 'transform 0.34s cubic-bezier(0.32,0.72,0,1)',
            }}>
              {/* the handle is its own non-scrolling strip (like the entry
                  sheet's): grabbable across the full width, and it stays put
                  instead of scrolling away with the plan */}
              <div onPointerDown={v.shiftGrab.start} onPointerMove={v.shiftGrab.move} onPointerUp={v.shiftGrab.end} onPointerCancel={v.shiftGrab.end}
                style={S('flex-shrink:0;padding:13px 0 13px;margin:-10px -16px 0;cursor:grab;touch-action:none')}>
                <div style={S('width:38px;height:4px;border-radius:99px;background:rgba(38,35,29,0.16);margin:0 auto')} />
              </div>
              <div onPointerDown={v.shiftGrab.bodyDown} onPointerMove={v.shiftGrab.bodyMove} onPointerUp={v.shiftGrab.bodyUp} onPointerCancel={v.shiftGrab.bodyUp}
                style={S('flex:1;min-height:0;overflow:auto;touch-action:pan-y;overscroll-behavior:contain')}>

              {v.sheetAsk && (
                <>
                  <div style={S('display:flex;align-items:center;justify-content:center;gap:14px;padding:6px 0 14px')}>
                    <div style={S('display:flex;flex-direction:column;align-items:center;gap:6px')}>
                      <div style={S(`width:56px;height:56px;border-radius:999px;background:${ME_COLOR};display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#FCFBF6`)}>{v.myInitial}</div>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#6E6659")}>{t('You')}</div>
                    </div>
                    <Sym style={{ fontSize: 28, color: 'var(--faint)', marginBottom: 22 }}>arrow_forward</Sym>
                    <div style={S('display:flex;flex-direction:column;align-items:center;gap:6px')}>
                      <div style={S(`width:56px;height:56px;border-radius:999px;background:${v.relieveColor};display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#FCFBF6`)}>{v.partnerInitial}</div>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#6E6659")}>{v.partnerName}</div>
                    </div>
                  </div>
                  <div style={S("text-align:center;font-family:'Nunito',sans-serif;font-weight:800;font-size:23px;letter-spacing:-0.02em")}>{v.askTitle}</div>
                  <div style={S('text-align:center;font-size:13.5px;color:#8C8474;padding-top:4px;text-wrap:pretty')}>{v.askSub}</div>

                  {v.askTargets && (
                    <div style={S('display:flex;gap:6px;flex-wrap:wrap;padding-top:14px')}>
                      {v.askTargets.map(c => (
                        <button key={c.key} type="button" onClick={c.onTap} style={S(`flex:1;min-width:80px;background:${c.bg};border:1px solid ${c.border};border-radius:999px;padding:8px 10px;font-family:inherit;font-size:12.5px;font-weight:600;color:${c.fg};cursor:pointer`)}>{c.label}</button>
                      ))}
                    </div>
                  )}

                  <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px 12px;margin-top:14px')}>
                    <div style={S('display:flex;align-items:center;justify-content:space-between;padding:10px 0 4px')}>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474")}>{v.askPlanLabel}</div>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#B5AC98")}>{t('from the usual rhythm')}</div>
                    </div>
                    {v.requestPlanRows.map((p, i) => (
                      <div key={i} style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                        <Sym style={{ fontSize: 18, color: p.color }}>{p.icon}</Sym>
                        <div style={S('flex:1;min-width:0;font-size:14px;font-weight:600;color:#4E4A3F')}>{p.label}</div>
                        <label style={S('position:relative;display:flex;align-items:center;gap:4px;cursor:pointer')}>
                          <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:13.5px;color:#26231D")}>{p.time}</div>
                          <Sym style={{ fontSize: 14, color: 'var(--faint)' }}>edit</Sym>
                          <input type="time" value={p.hm} onChange={p.onTime} onClick={v.showPicker} style={S('position:absolute;inset:0;width:100%;height:100%;opacity:0;border:0;padding:0;margin:0;cursor:pointer')} />
                        </label>
                        <button type="button" onClick={p.onToggle} style={S('background:none;border:none;padding:0;cursor:pointer;display:flex')}>
                          <Sym style={{ fontSize: 22, color: p.toggleColor }}>{p.toggleIcon}</Sym>
                        </button>
                      </div>
                    ))}
                    <div style={S('display:flex;flex-wrap:wrap;gap:6px;padding:8px 0 2px;border-top:1px solid rgba(38,35,29,0.07)')}>
                      {v.planAddDraft.open
                        ? v.planAddDraft.types.map(ty => (
                          <button key={ty.key} type="button" onClick={ty.onTap} className="hov-cream" style={S('display:flex;align-items:center;gap:6px;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;padding:6px 11px 6px 8px;cursor:pointer;font-family:inherit')}>
                            <Sym style={{ fontSize: 16, color: ty.color }}>{ty.icon}</Sym>
                            <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12.5px;color:#4E4A3F")}>{ty.label}</div>
                          </button>
                        ))
                        : (
                          <button type="button" onClick={v.planAddDraft.toggle} className="hov-dim" style={S('background:none;border:none;display:flex;align-items:center;gap:5px;cursor:pointer;font-family:inherit;padding:2px 0')}>
                            <Sym style={{ fontSize: 17, color: 'var(--soft)' }}>add</Sym>
                            <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12.5px;color:#8C8474")}>{t('Add to plan')}</div>
                          </button>
                        )}
                    </div>
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;padding-top:6px")}>{t('Until')}</div>
                    <div style={S('display:flex;gap:6px;padding-top:6px')}>
                      {v.untilOptions.map((u, i) => (
                        <button key={i} type="button" onClick={u.onTap} style={S(`flex:1;background:${u.bg};border:1px solid ${u.border};border-radius:999px;padding:8px 6px;font-family:inherit;font-size:12.5px;font-weight:600;color:${u.fg};cursor:pointer`)}>{u.label}</button>
                      ))}
                    </div>
                  </div>

                  <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:12px 16px;margin-top:10px;display:flex;flex-direction:column;gap:8px')}>
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474")}>{t('Anything they should know')}</div>
                    <input value={v.askNote} onChange={v.setAskNote} placeholder={v.askNotePlaceholder} style={S('width:100%;box-sizing:border-box;background:rgba(38,35,29,0.04);border:none;border-radius:12px;padding:12px 13px;font-size:14.5px;color:#26231D;outline:none')} />
                  </div>

                  <button type="button" onClick={v.sendAsk} className="hov-olive" style={S('margin-top:14px;width:100%;height:62px;background:var(--accent);border:none;border-radius:999px;display:flex;align-items:center;justify-content:center;gap:9px;cursor:pointer;font-family:inherit;box-shadow:0 6px 18px rgba(var(--accent-rgb),0.3)')}>
                    <Sym style={{ fontSize: 22, color: 'var(--on-accent)' }}>send</Sym>
                    <div style={S('font-size:16.5px;font-weight:700;color:#FCFBF6')}>{v.askCta}</div>
                  </button>
                  <div style={S('text-align:center;font-size:12px;color:#8C8474;padding-top:10px;text-wrap:pretty')}>{t('Duty moves when they accept — you stay on until then.')}</div>
                </>
              )}

              {v.sheetStart && (
                <>
                  <div style={S('display:flex;align-items:center;justify-content:center;gap:14px;padding:6px 0 14px')}>
                    {v.startPair && (
                      <>
                        <div style={S('display:flex;flex-direction:column;align-items:center;gap:6px')}>
                          <div style={S(`width:56px;height:56px;border-radius:999px;background:${v.relieveColor};display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#FCFBF6`)}>{v.relieveInitial}</div>
                          <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#6E6659")}>{v.relieveName}</div>
                        </div>
                        <Sym style={{ fontSize: 28, color: 'var(--faint)', marginBottom: 22 }}>arrow_forward</Sym>
                      </>
                    )}
                    <div style={S('display:flex;flex-direction:column;align-items:center;gap:6px')}>
                      <div style={S(`width:56px;height:56px;border-radius:999px;background:${ME_COLOR};display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#FCFBF6`)}>{v.myInitial}</div>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#6E6659")}>{t('You')}</div>
                    </div>
                  </div>
                  <div style={S("text-align:center;font-family:'Nunito',sans-serif;font-weight:800;font-size:23px;letter-spacing:-0.02em")}>{v.startTitle}</div>
                  <div style={S('text-align:center;font-size:13.5px;color:#8C8474;padding-top:4px;text-wrap:pretty')}>{v.startSub}</div>

                  {/* their running plan, read-only — the card this replaced on
                      Now. It answers "what are they in the middle of?" before
                      you decide to take over */}
                  {v.theirs && v.plan.length > 0 && (
                    <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px 10px;margin-top:18px')}>
                      <div style={S('display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0 2px')}>
                        <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474")}>{t('{name}’s shift', { name: v.shiftOwnerName })}</div>
                        <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12.5px;color:var(--accent-deep);background:rgba(var(--accent-rgb),0.14);border-radius:999px;padding:5px 11px")}>{v.nextUp}</div>
                      </div>
                      {v.plan.map((p, i) => (
                        <div key={i} style={S('display:flex;align-items:center;gap:11px;padding:10px 0;border-top:1px solid rgba(38,35,29,0.06)')}>
                          <Sym style={{ fontSize: 21, color: p.stateColor }}>{p.stateIcon}</Sym>
                          <Sym style={{ fontSize: 18, color: p.color }}>{p.icon}</Sym>
                          <div style={S('flex:1;min-width:0;display:flex;flex-direction:column;gap:1px')}>
                            <div style={S(`font-size:14.5px;font-weight:600;color:${p.textColor}`)}>{p.label}</div>
                            <div style={S('font-size:12px;color:#8C8474')}>{p.sub}</div>
                          </div>
                          <div style={S(`font-family:'Nunito',sans-serif;font-weight:600;font-size:13px;color:${p.whenColor}`)}>{p.when}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px;margin-top:18px')}>
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;padding:10px 0 4px")}>{t('Right now')}</div>
                    {v.handoffRows.map((r, i) => (
                      <div key={i} style={S('display:flex;align-items:baseline;gap:12px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                        <div style={S('flex:1;font-size:14px;color:#4E4A3F')}>{r.label}</div>
                        <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:13.5px;color:#26231D;text-align:right")}>{r.value}</div>
                      </div>
                    ))}
                  </div>

                  <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px 12px;margin-top:10px')}>
                    <div style={S('display:flex;align-items:center;justify-content:space-between;padding:10px 0 4px')}>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474")}>{t('Plan for your shift')}</div>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:11.5px;color:#B5AC98")}>{t('from the usual rhythm')}</div>
                    </div>
                    {v.requestPlanRows.map((p, i) => (
                      <div key={i} style={S('display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                        <Sym style={{ fontSize: 18, color: p.color }}>{p.icon}</Sym>
                        <div style={S('flex:1;min-width:0;font-size:14px;font-weight:600;color:#4E4A3F')}>{p.label}</div>
                        <label style={S('position:relative;display:flex;align-items:center;gap:4px;cursor:pointer')}>
                          <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:13.5px;color:#26231D")}>{p.time}</div>
                          <Sym style={{ fontSize: 14, color: 'var(--faint)' }}>edit</Sym>
                          <input type="time" value={p.hm} onChange={p.onTime} onClick={v.showPicker} style={S('position:absolute;inset:0;width:100%;height:100%;opacity:0;border:0;padding:0;margin:0;cursor:pointer')} />
                        </label>
                        <button type="button" onClick={p.onToggle} style={S('background:none;border:none;padding:0;cursor:pointer;display:flex')}>
                          <Sym style={{ fontSize: 22, color: p.toggleColor }}>{p.toggleIcon}</Sym>
                        </button>
                      </div>
                    ))}
                    <div style={S('display:flex;flex-wrap:wrap;gap:6px;padding:8px 0 2px;border-top:1px solid rgba(38,35,29,0.07)')}>
                      {v.planAddDraft.open
                        ? v.planAddDraft.types.map(ty => (
                          <button key={ty.key} type="button" onClick={ty.onTap} className="hov-cream" style={S('display:flex;align-items:center;gap:6px;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;padding:6px 11px 6px 8px;cursor:pointer;font-family:inherit')}>
                            <Sym style={{ fontSize: 16, color: ty.color }}>{ty.icon}</Sym>
                            <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12.5px;color:#4E4A3F")}>{ty.label}</div>
                          </button>
                        ))
                        : (
                          <button type="button" onClick={v.planAddDraft.toggle} className="hov-dim" style={S('background:none;border:none;display:flex;align-items:center;gap:5px;cursor:pointer;font-family:inherit;padding:2px 0')}>
                            <Sym style={{ fontSize: 17, color: 'var(--soft)' }}>add</Sym>
                            <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12.5px;color:#8C8474")}>{t('Add to plan')}</div>
                          </button>
                        )}
                    </div>
                    <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;padding-top:6px")}>{t('Until')}</div>
                    <div style={S('display:flex;gap:6px;padding-top:6px')}>
                      {v.untilOptions.map((u, i) => (
                        <button key={i} type="button" onClick={u.onTap} style={S(`flex:1;background:${u.bg};border:1px solid ${u.border};border-radius:999px;padding:8px 6px;font-family:inherit;font-size:12.5px;font-weight:600;color:${u.fg};cursor:pointer`)}>{u.label}</button>
                      ))}
                    </div>
                  </div>

                  <button type="button" onClick={v.startAction} className="hov-olive" style={S('margin-top:14px;width:100%;height:62px;background:var(--accent);border:none;border-radius:999px;display:flex;align-items:center;justify-content:center;gap:9px;cursor:pointer;font-family:inherit;box-shadow:0 6px 18px rgba(var(--accent-rgb),0.3)')}>
                    <Sym style={{ fontSize: 22, color: 'var(--on-accent)' }}>check</Sym>
                    <div style={S('font-size:16.5px;font-weight:700;color:#FCFBF6')}>{v.startCta}</div>
                  </button>
                  {v.canRequest && (
                    <button type="button" onClick={v.openAsk} className="hov-dim" style={S("margin-top:10px;width:100%;background:none;border:none;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;font-family:'Nunito',sans-serif;font-weight:600;font-size:12.5px;color:#5F6E42;padding:6px 0")}>
                      <Sym style={{ fontSize: 16, color: 'var(--accent-text)' }}>swap_horiz</Sym>
                      {v.askLabel}
                    </button>
                  )}
                  <div style={S('text-align:center;font-size:12px;color:#8C8474;padding-top:10px;text-wrap:pretty')}>{v.startFoot}</div>
                </>
              )}

              {v.sheetMine && (
                <>
                  <div style={S('display:flex;align-items:center;gap:12px;padding:4px 4px 14px')}>
                    <div style={S(`width:48px;height:48px;border-radius:999px;background:${ME_COLOR};display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:700;color:#FCFBF6`)}>{v.myInitial}</div>
                    <div style={S('display:flex;flex-direction:column;gap:2px')}>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:800;font-size:22px;letter-spacing:-0.02em")}>{t('Your shift')}</div>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12.5px;color:#8C8474")}>{v.shiftSince} · {v.shiftElapsed}</div>
                    </div>
                  </div>

                  {/* the live checklist that used to sit on Now — same rows,
                      same editable times, same one-tap drop */}
                  <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px 8px;margin-bottom:10px;display:flex;flex-direction:column;gap:4px')}>
                    <div style={S('display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0 2px')}>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474")}>{t('The plan for your shift')}</div>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12.5px;color:var(--accent-deep);background:rgba(var(--accent-rgb),0.14);border-radius:999px;padding:5px 11px")}>{v.nextUp}</div>
                    </div>
                    {v.plan.map((p, i) => (
                      <div key={i} style={S('display:flex;align-items:center;gap:11px;padding:10px 0;border-top:1px solid rgba(38,35,29,0.06)')}>
                        <Sym style={{ fontSize: 21, color: p.stateColor }}>{p.stateIcon}</Sym>
                        <Sym style={{ fontSize: 18, color: p.color }}>{p.icon}</Sym>
                        <div style={S('flex:1;min-width:0;display:flex;flex-direction:column;gap:1px')}>
                          <div style={S(`font-size:14.5px;font-weight:600;color:${p.textColor}`)}>{p.label}</div>
                          <div style={S('font-size:12px;color:#8C8474')}>{p.sub}</div>
                        </div>
                        {p.editable ? (
                          <label style={S('position:relative;display:flex;align-items:center;gap:4px;cursor:pointer')}>
                            <div style={S(`font-family:'Nunito',sans-serif;font-weight:600;font-size:13px;color:${p.whenColor}`)}>{p.when}</div>
                            <Sym style={{ fontSize: 14, color: 'var(--faint)' }}>edit</Sym>
                            <input type="time" value={p.hm} onChange={p.onTime} onClick={v.showPicker} style={S('position:absolute;inset:0;width:100%;height:100%;opacity:0;border:0;padding:0;margin:0;cursor:pointer')} />
                          </label>
                        ) : (
                          <div style={S(`font-family:'Nunito',sans-serif;font-weight:600;font-size:13px;color:${p.whenColor}`)}>{p.when}</div>
                        )}
                        {p.editable && (
                          <button type="button" onClick={p.onRemove} aria-label={t('Remove')} style={S('background:none;border:none;padding:0 0 0 2px;cursor:pointer;display:flex')}>
                            <Sym style={{ fontSize: 17, color: 'var(--dim)' }}>close</Sym>
                          </button>
                        )}
                      </div>
                    ))}
                    <div style={S('display:flex;flex-wrap:wrap;gap:6px;padding:8px 0 2px;border-top:1px solid rgba(38,35,29,0.06)')}>
                      {v.planAddLive.open
                        ? v.planAddLive.types.map(ty => (
                          <button key={ty.key} type="button" onClick={ty.onTap} className="hov-cream" style={S('display:flex;align-items:center;gap:6px;background:#FFFDF8;border:1px solid rgba(38,35,29,0.12);border-radius:999px;padding:6px 11px 6px 8px;cursor:pointer;font-family:inherit')}>
                            <Sym style={{ fontSize: 16, color: ty.color }}>{ty.icon}</Sym>
                            <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12.5px;color:#4E4A3F")}>{ty.label}</div>
                          </button>
                        ))
                        : (
                          <button type="button" onClick={v.planAddLive.toggle} className="hov-dim" style={S('background:none;border:none;display:flex;align-items:center;gap:5px;cursor:pointer;font-family:inherit;padding:2px 0')}>
                            <Sym style={{ fontSize: 17, color: 'var(--soft)' }}>add</Sym>
                            <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12.5px;color:#8C8474")}>{t('Add to plan')}</div>
                          </button>
                        )}
                    </div>
                  </div>

                  <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474;padding:0 4px 6px")}>{t('Your shift so far')}</div>
                  <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px')}>
                    {v.reportRows.map((r, i) => (
                      <div key={i} style={S('display:flex;align-items:baseline;gap:12px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                        <div style={S('flex:1;font-size:14px;color:#4E4A3F')}>{r.label}</div>
                        <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:13.5px;color:#26231D;text-align:right")}>{r.value}</div>
                      </div>
                    ))}
                  </div>
                  {/* the note rides the handback, so it only shows when there
                      IS one — a self-started shift has nobody to hand back to,
                      and the ask sheet carries its own note */}
                  {v.handedToMe && (
                    <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:12px 16px;margin-top:10px;display:flex;flex-direction:column;gap:8px')}>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12px;color:#8C8474")}>{t('Note for {name}', { name: v.hbName })}</div>
                      <input value={v.handbackNote} onChange={v.setHandbackNote} placeholder={t('e.g. took the 1am bottle slow, fell asleep on me')} style={S('width:100%;box-sizing:border-box;background:rgba(38,35,29,0.04);border:none;border-radius:12px;padding:12px 13px;font-size:14.5px;color:#26231D;outline:none')} />
                    </div>
                  )}
                  {/* two different things, and the verbs now say which is which:
                      handing back moves duty on the spot (they asked you to
                      cover, they're owed it back); asking waits for a yes */}
                  {v.handedToMe ? (
                    <>
                      <button type="button" onClick={v.handBack} className="hov-olive" style={S('margin-top:14px;width:100%;height:62px;background:var(--accent);border:none;border-radius:999px;display:flex;align-items:center;justify-content:center;gap:9px;cursor:pointer;font-family:inherit;box-shadow:0 6px 18px rgba(var(--accent-rgb),0.3)')}>
                        <Sym style={{ fontSize: 22, color: 'var(--on-accent)' }}>swap_horiz</Sym>
                        <div style={S('font-size:16.5px;font-weight:700;color:#FCFBF6')}>{t('Hand back to {name} now', { name: v.hbName })}</div>
                      </button>
                      {v.canRequest && (
                        <button type="button" onClick={v.openAsk} className="hov-dim" style={S("margin-top:10px;width:100%;background:none;border:none;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;font-family:'Nunito',sans-serif;font-weight:600;font-size:12.5px;color:#5F6E42;padding:6px 0")}>
                          <Sym style={{ fontSize: 16, color: 'var(--accent-text)' }}>schedule_send</Sym>
                          {v.askLabel}
                        </button>
                      )}
                    </>
                  ) : (
                    <button type="button" onClick={v.openAsk} className="hov-olive" style={S('margin-top:14px;width:100%;height:62px;background:var(--accent);border:none;border-radius:999px;display:flex;align-items:center;justify-content:center;gap:9px;cursor:pointer;font-family:inherit;box-shadow:0 6px 18px rgba(var(--accent-rgb),0.3)')}>
                      <Sym style={{ fontSize: 22, color: 'var(--on-accent)' }}>schedule_send</Sym>
                      <div style={S('font-size:16.5px;font-weight:700;color:#FCFBF6')}>{v.askLabel}</div>
                    </button>
                  )}
                  <div style={S('text-align:center;font-size:12px;color:#8C8474;padding-top:10px;text-wrap:pretty')}>{t(v.handedToMe ? 'Handing back moves duty straight away. Asking waits for them to accept.' : 'Duty moves when they accept — you stay on until then.')}</div>
                </>
              )}

              {v.sheetReport && (
                <>
                  <div style={S('display:flex;align-items:center;gap:12px;padding:4px 4px 14px')}>
                    <div style={S('width:48px;height:48px;border-radius:999px;background:rgba(var(--accent-rgb),0.16);display:flex;align-items:center;justify-content:center')}>
                      <Sym style={{ fontSize: 24, color: 'var(--accent-text)' }}>task_alt</Sym>
                    </div>
                    <div style={S('display:flex;flex-direction:column;gap:2px')}>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:800;font-size:22px;letter-spacing:-0.02em")}>{v.reportTitle}</div>
                      <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:12.5px;color:#8C8474")}>{v.reportRange}</div>
                    </div>
                  </div>
                  <div style={S('background:#FFFDF8;border:1px solid rgba(38,35,29,0.07);border-radius:26px;box-shadow:0 2px 14px rgba(38,35,29,0.06);padding:6px 16px')}>
                    {v.reportRows.map((r, i) => (
                      <div key={i} style={S('display:flex;align-items:baseline;gap:12px;padding:9px 0;border-top:1px solid rgba(38,35,29,0.07)')}>
                        <div style={S('flex:1;font-size:14px;color:#4E4A3F')}>{r.label}</div>
                        <div style={S("font-family:'Nunito',sans-serif;font-weight:600;font-size:13.5px;color:#26231D;text-align:right")}>{r.value}</div>
                      </div>
                    ))}
                  </div>
                  {v.hasHandbackNote && (
                    <div style={S('font-size:14.5px;line-height:1.45;color:#4E4A3F;background:rgba(var(--accent-rgb),0.09);border-radius:16px;padding:12px 14px;margin-top:10px')}>“{v.reportNote}”</div>
                  )}
                  <button type="button" onClick={v.closeShift} className="hov-dark" style={S('margin-top:14px;width:100%;height:56px;background:#26231D;border:none;border-radius:999px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-family:inherit')}>
                    <div style={S('font-size:16px;font-weight:700;color:#FAF6EF')}>{t('Done')}</div>
                  </button>
                </>
              )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }
}
