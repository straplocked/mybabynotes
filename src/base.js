// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// Where the app is mounted. The build is base-path-relative (vite `base: ''`)
// so one bundle serves both the origin root (every current deployment) and
// Home Assistant ingress at /api/hassio_ingress/<token>/ — ingress strips the
// prefix server-side but the browser URL keeps it, so anything '/'-rooted
// would escape the prefix and 404.
//
// `new URL('.', location.href)` is "the directory this document was served
// from": '/' and '/index.html' both give '/', an ingress URL gives
// '/api/hassio_ingress/<token>/'. That's correct here only because this is a
// single-screen SPA with no client-side routing — App.jsx's history entries
// are state-only (pushState with no URL) and its one replaceState keeps
// location.pathname, so the document URL never leaves where index.html lives.
export const APP_BASE = new URL('.', location.href).pathname

export const UNDER_INGRESS = location.pathname.includes('/api/hassio_ingress/')
