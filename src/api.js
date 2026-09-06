// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// Thin client for the Laravel API. Same-origin api/ under the app base
// (nginx proxies to the api container; base ≠ '/' only under HA ingress).
import { socketId } from './echo'
import { APP_BASE } from './base.js'
import { getLang } from './i18n.js'

const TOKEN_KEY = 'babylog:token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = t => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(APP_BASE + 'api' + path, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
      // lets the server broadcast toOthers() so we don't get poked by our own writes
      ...(socketId() ? { 'X-Socket-ID': socketId() } : {}),
      // device language: localizes validation/API errors and is remembered
      // account-side as the email-language fallback
      'X-App-Lang': getLang(),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err = new Error(data.message || res.statusText)
    err.status = res.status
    err.errors = data.errors
    throw err
  }
  return res.json()
}

export const api = {
  register: b => call('/register', { method: 'POST', body: b }), // {name, email, password, invite?}
  login: b => call('/login', { method: 'POST', body: b }),
  forgotPassword: email => call('/forgot-password', { method: 'POST', body: { email } }), // {sent, reason?}
  resetPassword: b => call('/reset-password', { method: 'POST', body: b }), // {token, email, password}
  logout: () => call('/logout', { method: 'POST' }),
  accountProfile: name => call('/account/profile', { method: 'POST', body: { name } }),
  accountEmail: b => call('/account/email', { method: 'POST', body: b }), // {email, password: current}
  accountPassword: b => call('/account/password', { method: 'POST', body: b }), // {current_password, password}
  state: since => call('/state?since=' + (since || 0)),
  setBaby: b => call('/baby', { method: 'POST', body: b }),
  // create ({name, birthdate?}) or update ({id, name, ...}) one child; archive via {archived}
  setChild: b => call('/children', { method: 'POST', body: b }),
  invite: (email, role) => call('/invite', { method: 'POST', body: { email, ...(role ? { role } : {}) } }), // role: 'parent' | 'caregiver'
  revokeInvite: email => call('/invite/revoke', { method: 'POST', body: { email } }),
  removeMember: userId => call('/household/remove-member', { method: 'POST', body: { user_id: userId } }),
  saveSettings: settings => call('/settings', { method: 'POST', body: settings }),
  pushSubscribe: b => call('/push/subscribe', { method: 'POST', body: b }), // {endpoint, keys:{p256dh,auth}, tz}
  pushUnsubscribe: endpoint => call('/push/unsubscribe', { method: 'POST', body: { endpoint } }),
  saveNotifyPrefs: prefs => call('/notify-prefs', { method: 'POST', body: prefs }),
  tokens: () => call('/tokens'), // {tokens: [...], scopes: {key: label}} — deliberately not in /state
  createToken: b => call('/tokens', { method: 'POST', body: b }), // {name, abilities, expires_in_days?} → plaintext token, shown once
  revokeToken: id => call('/tokens/revoke', { method: 'POST', body: { id } }),
  mqttGet: () => call('/integrations/mqtt'), // {config, status:{heartbeatAt}} — parents only, not in /state
  mqttSave: b => call('/integrations/mqtt', { method: 'POST', body: b }), // omit password to keep the stored one
  mqttTest: b => call('/integrations/mqtt/test', { method: 'POST', body: b }), // {ok, message?} — a 200 either way
  pushEntries: entries => call('/entries', { method: 'POST', body: { entries } }),
  // baby_id absent → primary child; id is our client-generated timer id (entry-style)
  timerStart: (type, babyId, id) => call('/timer/start', { method: 'POST', body: { type, ...(babyId != null ? { baby_id: babyId } : {}), ...(id ? { id } : {}) } }),
  timerStop: id => call('/timer/stop', { method: 'POST', ...(id ? { body: { id } } : {}) }),
  shiftRequest: note => call('/shifts/request', { method: 'POST', body: { note } }),
  shiftAccept: (plan, until, untilAt) => call('/shifts/accept', { method: 'POST', body: { plan, until, until_at: untilAt } }), // until_at: ms epoch or null
  shiftPlan: plan => call('/shifts/plan', { method: 'POST', body: { plan } }),
  shiftHandback: note => call('/shifts/handback', { method: 'POST', body: { note } }),
}
