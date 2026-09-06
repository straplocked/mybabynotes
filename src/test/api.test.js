// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// The api module's contract with the server: headers, auth, error shaping.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../echo.js', () => ({ socketId: vi.fn() }))

import { api, getToken, setToken } from '../api.js'
import { socketId } from '../echo.js'

const okJson = data => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) })

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => okJson({})))
  socketId.mockReturnValue(undefined)
})

describe('token storage', () => {
  it('round-trips through localStorage and clears on null', () => {
    setToken('tok-1')
    expect(getToken()).toBe('tok-1')
    setToken(null)
    expect(getToken()).toBeNull()
    expect(localStorage.getItem('babylog:token')).toBeNull()
  })
})

describe('request shape', () => {
  it('GETs /state under /api with only Accept + device language when signed out', async () => {
    await api.state(1234)
    const [url, opts] = fetch.mock.calls[0]
    expect(url).toBe('/api/state?since=1234')
    expect(opts.method).toBe('GET')
    // X-App-Lang always rides — it localizes validation errors and is the
    // account's email-language fallback server-side
    expect(opts.headers).toEqual({ Accept: 'application/json', 'X-App-Lang': 'en' })
    expect(opts.body).toBeUndefined()
  })

  it('a missing since falls back to 0', async () => {
    await api.state()
    expect(fetch.mock.calls[0][0]).toBe('/api/state?since=0')
  })

  it('sends the bearer token and socket id when present', async () => {
    setToken('tok-2')
    socketId.mockReturnValue('sock-9')
    await api.state(0)
    expect(fetch.mock.calls[0][1].headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer tok-2',
      'X-Socket-ID': 'sock-9',
      'X-App-Lang': 'en',
    })
  })

  it('POSTs JSON with a Content-Type only when there is a body', async () => {
    await api.login({ email: 'a@b.c', password: 'pw' })
    const [url, opts] = fetch.mock.calls[0]
    expect(url).toBe('/api/login')
    expect(opts.method).toBe('POST')
    expect(opts.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(opts.body)).toEqual({ email: 'a@b.c', password: 'pw' })
  })

  it('bodyless POSTs (logout) skip the Content-Type header', async () => {
    await api.logout()
    const opts = fetch.mock.calls[0][1]
    expect(opts.body).toBeUndefined()
    expect(opts.headers['Content-Type']).toBeUndefined()
  })
})

describe('error shaping', () => {
  it('surfaces the server message, status and validation errors', async () => {
    fetch.mockResolvedValue({
      ok: false, status: 422, statusText: 'Unprocessable Content',
      json: () => Promise.resolve({ message: 'The email field is required.', errors: { email: ['The email field is required.'] } }),
    })
    const err = await api.login({}).catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('The email field is required.')
    expect(err.status).toBe(422)
    expect(err.errors).toEqual({ email: ['The email field is required.'] })
  })

  it('falls back to statusText when the error body is not JSON', async () => {
    fetch.mockResolvedValue({
      ok: false, status: 502, statusText: 'Bad Gateway',
      json: () => Promise.reject(new SyntaxError('nope')),
    })
    const err = await api.state(0).catch(e => e)
    expect(err.message).toBe('Bad Gateway')
    expect(err.status).toBe(502)
    expect(err.errors).toBeUndefined()
  })
})
