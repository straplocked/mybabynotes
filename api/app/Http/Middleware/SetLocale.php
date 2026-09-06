<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

/**
 * The app sends its device language as X-App-Lang on every request (the same
 * per-device pref that drives the frontend catalogs). A supported value
 * localizes this request — validation errors and custom API messages come
 * back in the device's language — and is remembered on users.lang as "the
 * language this account was last seen using", which emails fall back to
 * (they have no device to ask).
 */
class SetLocale
{
    public function handle(Request $request, Closure $next)
    {
        $lang = $request->header('X-App-Lang');
        if (is_string($lang) && in_array($lang, config('babylog.locales', []), true)) {
            app()->setLocale($lang);
            // resolve through the sanctum guard directly — this runs before the
            // group's auth middleware, and guest routes (login) just get null
            $user = $request->user('sanctum');
            if ($user && $user->lang !== $lang) {
                $user->forceFill(['lang' => $lang])->saveQuietly();
            }
        }

        return $next($request);
    }
}
