<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Support;

/**
 * The public API's token scopes (Sanctum abilities). Single source of truth:
 * token validation, the Settings UI copy, the OpenAPI security description,
 * and MCP tool-level checks all read from here. First-party app tokens carry
 * ['*'] and pass every check; scopes only ever narrow third-party tokens.
 */
class ApiScopes
{
    public const SCOPES = [
        'profile:read' => 'Read your profile and household members',
        'children:read' => 'Read the children in your log',
        'entries:read' => 'Read log entries',
        'entries:write' => 'Create, edit, and delete log entries',
        'timer:read' => 'See the running timer',
        'timer:write' => 'Start and stop timers',
        'mcp' => 'Connect AI assistants via MCP',
    ];

    /** @return string[] */
    public static function keys(): array
    {
        return array_keys(self::SCOPES);
    }
}
