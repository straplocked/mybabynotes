// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
import React from 'react'

// The baby-face mark from the marketing comp (Landing.dc.html) — fixed brand
// colors on purpose: the face reads as the logo, not as themable UI.
export default function Logo({ size = 36 }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true"
      style={{ display: 'block', flexShrink: 0, overflow: 'visible' }}>
      <circle cx="20" cy="21" r="15" fill="#F3D3B9" />
      <path d="M9 14.5c3-7.5 7-11 11-11s8.5 3.5 11 10c-3.5-2-7.5-1.5-11 .8-3.5-2.3-7.5-2.3-11 .2z" fill="#B5566A" />
      <ellipse cx="6" cy="22" rx="2.6" ry="3.2" fill="#F3D3B9" />
      <ellipse cx="34" cy="22" rx="2.6" ry="3.2" fill="#F3D3B9" />
      <path d="M13.5 23q2-2 4 0" stroke="#5B554A" strokeWidth="1.7" fill="none" strokeLinecap="round" />
      <path d="M22.5 23q2-2 4 0" stroke="#5B554A" strokeWidth="1.7" fill="none" strokeLinecap="round" />
      <ellipse cx="12" cy="27" rx="2.6" ry="1.6" fill="#EFA894" opacity=".7" />
      <ellipse cx="28" cy="27" rx="2.6" ry="1.6" fill="#EFA894" opacity=".7" />
      <path d="M17.8 28.5q2.2 1.9 4.4 0" stroke="#B5566A" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  )
}

// The tri-color wordmark, also from the comp: my|baby|notes in ink/accent/deep.
// Spans inherit the parent's font sizing; colors follow the household theme.
export function Wordmark() {
  return (
    <>
      <span style={{ color: 'var(--ink)' }}>my</span>
      <span style={{ color: 'var(--accent)' }}>baby</span>
      <span style={{ color: 'var(--accent-deep)' }}>notes</span>
    </>
  )
}
