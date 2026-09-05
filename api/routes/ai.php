<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

use App\Mcp\Servers\BabylogServer;
use Laravel\Mcp\Facades\Mcp;

// Streamable HTTP MCP server, stateless: each JSON-RPC message is one plain
// php-fpm request. Same Sanctum tokens as the API; the `mcp` scope gates the
// endpoint and tools check granular scopes themselves (read-only tokens work).
// Every write tool goes through EntryWriter/TimerService, so MCP obeys the
// same sync invariants as everything else.
Mcp::web('/mcp', BabylogServer::class)
    ->middleware(['auth:sanctum', 'ability:mcp', 'throttle:120,1']);
