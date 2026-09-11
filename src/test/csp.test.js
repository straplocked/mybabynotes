// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// The Content-Security-Policy nginx sends allows exactly one inline script:
// the pre-paint dark check in index.html, pinned by sha256. Vite copies that
// block into dist/index.html byte-for-byte (no re-indent, no minify — the
// build is checked below when a dist/ exists), so the hash of the SOURCE is
// the hash the browser computes. Edit the script → this fails until both
// nginx files carry the new hash.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../..')
const read = rel => readFileSync(resolve(root, rel), 'utf8')

// the one bare (non-module) <script> block; the module entry is src=…
const inlineScript = html => {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
  expect(blocks).toHaveLength(1)
  return blocks[0]
}

const sha256 = s => 'sha256-' + createHash('sha256').update(s).digest('base64')

const cspLines = conf =>
  conf.split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('add_header Content-Security-Policy '))

const policyOf = line => {
  const m = line.match(/^add_header Content-Security-Policy "([^"]+)" always;$/)
  expect(m, `malformed CSP line: ${line}`).not.toBeNull()
  return m[1]
}

const NGINX = ['nginx.conf', 'deploy/aio/nginx.conf']

describe('Content-Security-Policy', () => {
  const hash = sha256(inlineScript(read('index.html')))

  it('the built index.html keeps the inline script byte-identical to the source', () => {
    if (!existsSync(resolve(root, 'dist/index.html'))) return // no build here; the hash-of-source rule is documented above
    expect(inlineScript(read('dist/index.html'))).toBe(inlineScript(read('index.html')))
  })

  it.each(NGINX)('%s sends the policy from the server block and both add_header-overriding locations', file => {
    const lines = cspLines(read(file))
    // server level + location /assets/ + location = /sw.js — a location-level
    // add_header replaces the server-level set, so fewer than three means a
    // response class lost the header
    expect(lines).toHaveLength(3)
    expect(new Set(lines).size).toBe(1)
  })

  it.each(NGINX)("%s's policy allows the pre-paint script by its current hash", file => {
    const policy = policyOf(cspLines(read(file))[0])
    const scriptSrc = policy.split(';').map(d => d.trim()).find(d => d.startsWith('script-src '))
    expect(scriptSrc).toBe(`script-src 'self' '${hash}'`)
  })

  it('both nginx files send the same policy', () => {
    const [a, b] = NGINX.map(f => policyOf(cspLines(read(f))[0]))
    expect(a).toBe(b)
  })

  it('the only third-party origins are the two Google Fonts hosts', () => {
    const policy = policyOf(cspLines(read('nginx.conf'))[0])
    const origins = [...new Set(policy.match(/https?:\/\/[^\s;]+/g))].sort()
    expect(origins).toEqual(['https://fonts.googleapis.com', 'https://fonts.gstatic.com'])
    // fonts are stylesheets + font files, nothing else may talk to them
    for (const d of policy.split(';').map(s => s.trim())) {
      if (d.includes('fonts.googleapis.com')) expect(d).toMatch(/^style-src /)
      if (d.includes('fonts.gstatic.com')) expect(d).toMatch(/^font-src /)
    }
  })

  it('never loosens the directives that make the localStorage token worth stealing', () => {
    const policy = policyOf(cspLines(read('nginx.conf'))[0])
    const dirs = Object.fromEntries(policy.split(';').map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(' ')]))
    expect(dirs['default-src']).toBe("'self'")
    expect(dirs['connect-src']).toBe("'self'")
    expect(dirs['object-src']).toBe("'none'")
    expect(dirs['base-uri']).toBe("'self'")
    expect(dirs['form-action']).toBe("'self'")
    expect(dirs['frame-ancestors']).toBe("'self'")
    expect(dirs['worker-src']).toBe("'self'")
    expect(dirs['script-src']).not.toContain('unsafe')
  })
})
