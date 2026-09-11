<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Middleware;

use App\Services\PushService;
use Closure;
use Illuminate\Http\Request;

/**
 * Web Push sends leave the request's critical path. During an HTTP request
 * PushService only buffers what the write asked for; this middleware's
 * terminate() — which the kernel runs after the response has gone out (under
 * php-fpm, after fastcgi_finish_request, so the phone isn't held while we
 * talk to FCM/APNs/Mozilla) — ships the buffer. Global, so every producer
 * (the PWA routes, /api/v1, MCP) gets it. Console commands never pass through
 * here and keep sending inline; nothing is waiting on them.
 */
class SendPushAfterResponse
{
    public function handle(Request $request, Closure $next)
    {
        app(PushService::class)->deferUntilTerminate();

        return $next($request);
    }

    public function terminate(Request $request, $response): void
    {
        app(PushService::class)->flush();
    }
}
