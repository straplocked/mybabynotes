<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

use App\Http\Controllers\Api\AccountController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\MqttController;
use App\Http\Controllers\Api\PushController;
use App\Http\Controllers\Api\ShiftController;
use App\Http\Controllers\Api\SyncController;
use App\Http\Controllers\Api\TimerController;
use App\Http\Controllers\Api\TokenController;
use Illuminate\Support\Facades\Route;

Route::post('/register', [AuthController::class, 'register'])->middleware('throttle:10,1');
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1');
Route::post('/forgot-password', [AuthController::class, 'forgotPassword'])->middleware('throttle:10,1');
Route::post('/reset-password', [AuthController::class, 'resetPassword'])->middleware('throttle:10,1');

Route::middleware(['auth:sanctum', 'throttle:120,1'])->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);

    Route::post('/account/profile', [AccountController::class, 'profile']);
    Route::post('/account/email', [AccountController::class, 'email']);
    Route::post('/account/password', [AccountController::class, 'password']);

    // abilities:* = first-party app tokens only — a PAT can never mint or
    // revoke PATs, closing the escalation loop
    Route::middleware('abilities:*')->group(function () {
        Route::get('/tokens', [TokenController::class, 'index']);
        Route::post('/tokens', [TokenController::class, 'store']);
        Route::post('/tokens/revoke', [TokenController::class, 'revoke']);
    });

    Route::get('/state', [SyncController::class, 'state']);
    Route::post('/baby', [SyncController::class, 'setBaby']);
    Route::post('/children', [SyncController::class, 'setChild']);
    Route::post('/invite', [SyncController::class, 'invite']);
    Route::post('/invite/revoke', [SyncController::class, 'revokeInvite']);
    Route::post('/household/remove-member', [SyncController::class, 'removeMember']);
    Route::post('/settings', [SyncController::class, 'setSettings']);
    Route::post('/entries', [SyncController::class, 'pushEntries']);

    Route::post('/push/subscribe', [PushController::class, 'subscribe']);
    Route::post('/push/unsubscribe', [PushController::class, 'unsubscribe']);
    Route::post('/notify-prefs', [PushController::class, 'prefs']);

    Route::post('/timer/start', [TimerController::class, 'start']);
    Route::post('/timer/stop', [TimerController::class, 'stop']);

    Route::get('/integrations/mqtt', [MqttController::class, 'show']);
    Route::post('/integrations/mqtt', [MqttController::class, 'save']);
    Route::post('/integrations/mqtt/test', [MqttController::class, 'test']);

    Route::post('/shifts/request', [ShiftController::class, 'request']);
    Route::post('/shifts/accept', [ShiftController::class, 'accept']);
    Route::post('/shifts/plan', [ShiftController::class, 'plan']);
    Route::post('/shifts/handback', [ShiftController::class, 'handback']);
});
