// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
import '@testing-library/jest-dom/vitest'

// jsdom has no matchMedia; fx.js and App both probe it. Default to "light,
// no reduced motion" — tests that care replace window.matchMedia themselves.
if (!window.matchMedia) {
  window.matchMedia = query => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })
}

afterEach(() => {
  localStorage.clear()
})
