<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Controllers\Api;

use App\Events\HouseholdTouched;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * The signed-in grown-up's own account: display name, email, password.
 * Every change pokes the household — a renamed parent should show up on the
 * partner's duty rows without waiting for the heartbeat poll.
 */
class AccountController extends Controller
{
    public function profile(Request $request): JsonResponse
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:100']]);

        $user = $request->user();
        $user->update(['name' => $data['name']]);

        HouseholdTouched::send($user->household->id, 'account');

        return response()->json(['ok' => true, 'name' => $user->name]);
    }

    public function email(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email', 'max:255'],
            'password' => ['required', 'string'],
        ]);

        $user = $request->user();
        if (! Hash::check($data['password'], $user->password)) {
            throw ValidationException::withMessages([
                'password' => [__('That’s not your current password — nothing was changed.')],
            ]);
        }

        // stored lowercase everywhere (register/invite do the same), so the
        // duplicate check runs on the normalized address
        $email = strtolower($data['email']);
        if (User::where('email', $email)->where('id', '!=', $user->id)->exists()) {
            throw ValidationException::withMessages([
                'email' => [__('That email already belongs to an account here.')],
            ]);
        }

        $user->update(['email' => $email]);

        HouseholdTouched::send($user->household->id, 'account');

        return response()->json(['ok' => true, 'email' => $user->email]);
    }

    public function password(Request $request): JsonResponse
    {
        $data = $request->validate([
            'current_password' => ['required', 'string'],
            'password' => ['required', 'string', 'min:8'],
        ]);

        $user = $request->user();
        if (! Hash::check($data['current_password'], $user->password)) {
            throw ValidationException::withMessages([
                'current_password' => [__('That’s not your current password — nothing was changed.')],
            ]);
        }

        $user->forceFill(['password' => $data['password']])->save(); // hashed by the cast
        // every other *session* dies with the old password; the phone making
        // the change keeps its token so the user isn't logged out mid-settings.
        // Personal access tokens survive a routine password change (GitHub
        // style) — forgot-password reset still revokes everything.
        $user->tokens()->where('name', 'app')
            ->where('id', '!=', $user->currentAccessToken()->id)->delete();

        HouseholdTouched::send($user->household->id, 'account');

        return response()->json(['ok' => true]);
    }
}
