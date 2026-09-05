<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Mcp\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Carbon;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[IsReadOnly]
#[Description('List log entries, newest first. Detail semantics by type: bottle/pump = ounces, nurse = side, sleep/tummy = minutes.')]
class ListEntries extends BabylogTool
{
    public function schema(JsonSchema $schema): array
    {
        return [
            'baby_id' => $schema->integer()->description('Filter to one child (see list_children).'),
            'types' => $schema->array()->description('Filter to entry types, e.g. ["bottle","nurse"]. Known types: bottle, nurse, pump, wet, dirty, both, sleep, tummy, bath, meds.'),
            'since' => $schema->string()->description('Only entries at/after this ISO 8601 time.'),
            'until' => $schema->string()->description('Only entries at/before this ISO 8601 time.'),
            'limit' => $schema->integer()->description('Max entries to return (default 50, max 200).'),
        ];
    }

    public function handle(Request $request): Response
    {
        if ($denied = $this->requireAbilities($request, 'entries:read')) {
            return $denied;
        }

        $user = $this->user($request);
        $household = $user->household;
        $query = $household->entries()->where('deleted', false);

        if ($babyId = $request->get('baby_id')) {
            if (! $household->children()->whereKey((int) $babyId)->exists()) {
                return Response::error('That child isn’t in this household — call list_children for valid ids.');
            }
            $primaryId = $household->children()->orderBy('id')->value('id');
            $query->where(fn ($q) => (int) $babyId === $primaryId
                ? $q->where('baby_id', $babyId)->orWhereNull('baby_id')
                : $q->where('baby_id', $babyId));
        }
        if (is_array($request->get('types')) && $request->get('types') !== []) {
            $query->whereIn('type', $request->get('types'));
        }
        try {
            if ($since = $request->get('since')) {
                $query->where('t', '>=', Carbon::parse($since)->getTimestampMs());
            }
            if ($until = $request->get('until')) {
                $query->where('t', '<=', Carbon::parse($until)->getTimestampMs());
            }
        } catch (\Throwable) {
            return Response::error('since/until must be ISO 8601 timestamps, e.g. 2026-09-05T06:00:00Z.');
        }

        $limit = min(max((int) ($request->get('limit') ?: 50), 1), 200);
        $primaryChildId = $household->children()->orderBy('id')->value('id');
        $names = $this->memberNames($user);

        return Response::json([
            'entries' => $query->orderByDesc('t')->orderByDesc('id')->limit($limit)->get()
                ->map(fn ($e) => $this->entryArray($e, $primaryChildId, $names))->all(),
        ]);
    }
}
