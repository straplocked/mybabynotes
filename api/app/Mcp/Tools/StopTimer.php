<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Mcp\Tools;

use App\Services\EntryWriter;
use App\Services\TimerService;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;

#[Description('Stop a running timer (several can run at once — get_timer lists them; omitting timer_id stops your newest), optionally logging the resulting entry (like the app does): sleep and tummy time log elapsed minutes as detail; nurse logs the side you pass as detail; pump logs the ounces you pass as detail.')]
class StopTimer extends BabylogTool
{
    public function schema(JsonSchema $schema): array
    {
        return [
            'timer_id' => $schema->string()->max(64)->description('Which timer to stop (ids from get_timer). Omitted: the caller\'s newest timer.'),
            'log' => $schema->boolean()->description('Also log the entry the timer was tracking (default true).'),
            'detail' => $schema->string()->max(100)->description('Detail for the logged entry: side for nurse (e.g. "L"), ounces for pump. Ignored for sleep/tummy (elapsed minutes are used).'),
        ];
    }

    public function handle(Request $request): Response
    {
        if ($denied = $this->requireAbilities($request, 'timer:write')) {
            return $denied;
        }

        $user = $this->user($request);
        $timerId = $request->get('timer_id');
        $stopped = app(TimerService::class)->stop($user, $timerId !== null ? (string) $timerId : null);
        if (! $stopped) {
            return Response::json(['stopped' => null, 'logged' => null]);
        }

        $log = $request->get('log') ?? true;
        if (! $log) {
            return Response::json(['stopped' => $stopped, 'logged' => null]);
        }
        if ($denied = $this->requireAbilities($request, 'entries:write')) {
            return $denied; // timer already stopped; say why nothing was logged
        }

        // the stop itself never writes an entry (server invariant) — this tool
        // acts as the client and logs it, exactly like the PWA after a stop
        $elapsedMinutes = (int) max(1, round((now()->getTimestampMs() - $stopped['started_at']) / 60000));
        $detail = in_array($stopped['type'], ['sleep', 'tummy'], true)
            ? (string) $elapsedMinutes
            : ($request->get('detail') !== null ? (string) $request->get('detail') : null);

        $entry = app(EntryWriter::class)->create($user, [
            'type' => $stopped['type'],
            't' => now()->getTimestampMs(),
            'detail' => $detail,
            'baby_id' => $stopped['baby_id'] ?? null,
        ]);

        $primary = $user->household->children()->orderBy('id')->value('id');

        return Response::json([
            'stopped' => $stopped,
            'elapsed_minutes' => $elapsedMinutes,
            'logged' => $this->entryArray($entry, $primary, $this->memberNames($user)),
        ]);
    }
}
