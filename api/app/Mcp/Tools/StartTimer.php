<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Mcp\Tools;

use App\Services\TimerService;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;

#[Description('Start a timer. Timers stack — one per (type, child, starter); re-starting an identical session returns the one already running. The rest of the household gets notified.')]
class StartTimer extends BabylogTool
{
    public function schema(JsonSchema $schema): array
    {
        return [
            'type' => $schema->string()->enum(['nurse', 'pump', 'sleep', 'tummy'])->description('What the timer tracks.')->required(),
            'baby_id' => $schema->integer()->description('Which child (default: the primary child).'),
        ];
    }

    public function handle(Request $request): Response
    {
        if ($denied = $this->requireAbilities($request, 'timer:write')) {
            return $denied;
        }

        if (! in_array($request->get('type'), ['nurse', 'pump', 'sleep', 'tummy'], true)) {
            return Response::error('type must be nurse, pump, sleep, or tummy.');
        }

        $timer = app(TimerService::class)->start(
            $this->user($request),
            (string) $request->get('type'),
            $request->get('baby_id') !== null ? (int) $request->get('baby_id') : null,
        );

        return Response::json(['timer' => $timer]);
    }
}
