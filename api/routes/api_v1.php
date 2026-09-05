<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

// The public, versioned API surface (see docs/integrations.md and the
// committed docs/openapi.v1.json). The unversioned routes/api.php is the
// PWA's private contract; this one is frozen/additive-only for third
// parties, gated per-route by token scopes (App\Support\ApiScopes). The
// named 'v1' limiter keeps integrations out of the PWA's throttle bucket.

use App\Http\Controllers\Api\V1\ChildController;
use App\Http\Controllers\Api\V1\EntryController;
use App\Http\Controllers\Api\V1\MeController;
use App\Http\Controllers\Api\V1\TimerController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'throttle:v1'])->group(function () {
    Route::get('/me', [MeController::class, 'show'])->middleware('abilities:profile:read');

    Route::get('/children', [ChildController::class, 'index'])->middleware('abilities:children:read');
    Route::get('/children/{id}', [ChildController::class, 'show'])->middleware('abilities:children:read')
        ->whereNumber('id');

    Route::get('/entries', [EntryController::class, 'index'])->middleware('abilities:entries:read');
    Route::post('/entries', [EntryController::class, 'store'])->middleware('abilities:entries:write');
    Route::get('/entries/{id}', [EntryController::class, 'show'])->middleware('abilities:entries:read');
    Route::patch('/entries/{id}', [EntryController::class, 'update'])->middleware('abilities:entries:write');
    Route::delete('/entries/{id}', [EntryController::class, 'destroy'])->middleware('abilities:entries:write');

    Route::get('/timer', [TimerController::class, 'show'])->middleware('abilities:timer:read');
    Route::put('/timer', [TimerController::class, 'store'])->middleware('abilities:timer:write');
    Route::delete('/timer', [TimerController::class, 'destroy'])->middleware('abilities:timer:write');
});
