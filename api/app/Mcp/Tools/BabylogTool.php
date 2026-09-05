<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Mcp\Tools;

use App\Models\User;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tool;

/**
 * Base for every MyBabyNotes tool. The `ability:mcp` route middleware already
 * gates the endpoint; tools additionally check granular scopes (the same
 * names as /api/v1 — see App\Support\ApiScopes) so a read-only MCP token is
 * possible. First-party app tokens carry ['*'] and pass every check. All
 * household access goes through $request->user()->household — a tool never
 * accepts a household id from the client.
 */
abstract class BabylogTool extends Tool
{
    protected function user(Request $request): User
    {
        return $request->user();
    }

    /** Non-null Response means "stop and return this error". */
    protected function requireAbilities(Request $request, string ...$abilities): ?Response
    {
        foreach ($abilities as $ability) {
            if (! $this->user($request)->tokenCan($ability)) {
                return Response::error("This token lacks the `{$ability}` scope. Create one with it in Settings → API access.");
            }
        }

        return null;
    }

    /** Presentable entry shape shared by list/log/update tools. */
    protected function entryArray(object $entry, ?int $primaryChildId, array $names): array
    {
        return [
            'id' => $entry->id,
            'baby_id' => $entry->baby_id ?? $primaryChildId,
            'type' => $entry->type,
            't' => (int) $entry->t,
            'time' => \Illuminate\Support\Carbon::createFromTimestampMs($entry->t)->toIso8601String(),
            'detail' => $entry->detail,
            'deleted' => (bool) $entry->deleted,
            'by' => $names[$entry->user_id] ?? null,
        ];
    }

    /** user_id => name, including former members so old entries still resolve. */
    protected function memberNames(User $user): array
    {
        $household = $user->household;
        $names = $household->users->pluck('name', 'id')->all();
        foreach ($household->former_members ?? [] as $m) {
            $names[(int) $m['id']] ??= (string) $m['name'];
        }

        return $names;
    }
}
