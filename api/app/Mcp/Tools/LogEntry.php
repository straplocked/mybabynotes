<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Mcp\Tools;

use App\Services\EntryWriter;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Carbon;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;

#[Description('Log one entry (a feed, diaper, sleep, tummy time, bath, or meds). Detail semantics: bottle/pump = ounces, nurse = side (L/R), sleep/tummy = minutes (sleep may carry a Nap/Night tag, e.g. "Nap · 45m").')]
class LogEntry extends BabylogTool
{
    public function schema(JsonSchema $schema): array
    {
        return [
            'type' => $schema->string()
                ->enum(['bottle', 'nurse', 'pump', 'wet', 'dirty', 'both', 'sleep', 'tummy', 'bath', 'meds'])
                ->description('What happened.')->required(),
            'time' => $schema->string()->description('When, ISO 8601 (default: now).'),
            'detail' => $schema->string()->max(100)->description('Type-specific detail: ounces for bottle/pump, side for nurse, minutes for sleep/tummy.'),
            'baby_id' => $schema->integer()->description('Which child (default: the primary child).'),
        ];
    }

    public function handle(Request $request): Response
    {
        if ($denied = $this->requireAbilities($request, 'entries:write')) {
            return $denied;
        }

        $user = $this->user($request);
        try {
            $t = $request->get('time')
                ? Carbon::parse($request->get('time'))->getTimestampMs()
                : now()->getTimestampMs();
        } catch (\Throwable) {
            return Response::error('time must be an ISO 8601 timestamp, e.g. 2026-09-05T06:00:00Z.');
        }

        $babyId = $request->get('baby_id');
        if ($babyId !== null && ! $user->household->children()->whereKey((int) $babyId)->exists()) {
            return Response::error('That child isn’t in this household — call list_children for valid ids.');
        }

        // the tool is the acting client, so it generates the UUID (the server
        // itself never invents entry state)
        $entry = app(EntryWriter::class)->create($user, [
            'type' => (string) $request->get('type'),
            't' => $t,
            'detail' => $request->get('detail') !== null ? (string) $request->get('detail') : null,
            'baby_id' => $babyId !== null ? (int) $babyId : null,
        ]);

        $primary = $user->household->children()->orderBy('id')->value('id');

        return Response::json(['logged' => $this->entryArray($entry, $primary, $this->memberNames($user))]);
    }
}
