<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MeController extends Controller
{
    /** Who am I, and what household am I in. */
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();
        $household = $user->household()->with('users')->first();

        return response()->json([
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'role' => $user->role ?? 'parent',
            ],
            'household' => [
                'id' => $household->id,
                'members' => $household->users->sortBy('id')->values()
                    ->map(fn (User $u) => ['id' => $u->id, 'name' => $u->name, 'role' => $u->role ?? 'parent'])->all(),
                'on_duty_user_id' => $household->on_duty_user_id,
            ],
            'server_time' => now()->getTimestampMs(),
        ]);
    }
}
