<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Controllers\Api;

use App\Contracts\AccountProvisioner;
use App\Events\HouseholdTouched;
use App\Http\Controllers\Controller;
use App\Mail\PasswordResetLink;
use App\Models\Household;
use App\Models\Invite;
use App\Models\User;
use App\Support\AppMail;
use Illuminate\Auth\Events\Registered;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Password;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function register(Request $request, AccountProvisioner $provisioner): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8'],
            'invite' => ['nullable', 'string', 'max:20'],
        ]);
        $data['email'] = strtolower($data['email']);

        // an invite to this email drops the new user into the inviter's household —
        // but only with the single-use code the inviter was shown
        $invite = Invite::where('email', $data['email'])->first();

        if ($invite) {
            $code = strtoupper(preg_replace('/[^a-z0-9]/i', '', (string) ($data['invite'] ?? '')));
            if ($code === '' || ! hash_equals((string) $invite->code_hash, hash('sha256', $code))) {
                throw ValidationException::withMessages([
                    'invite' => ['Check the invite code your partner was shown when they invited you.'],
                ]);
            }
            if ($invite->household->users()->count() >= config('babylog.max_household_users')) {
                throw ValidationException::withMessages([
                    'email' => ['This log is full.'],
                ]);
            }
        }

        // no invite: the provisioner decides whether the registration may
        // proceed and where it lands — the default keeps the appliance
        // invite-only after the first account claims the instance
        // (config/babylog.php: account_provisioner)
        $household = $invite?->household ?? $provisioner->provision($data['email']);

        $user = User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'password' => $data['password'],
            'household_id' => $household->id,
            // the invite decides the seat; the first / open-registration account is a parent
            'role' => $invite?->role ?? 'parent',
        ]);

        $invite?->delete(); // single-use: the seat is taken

        // standard Laravel hook — lets anything layered on the app react to a
        // fresh account (verification mail, hosted provisioning) without a
        // controller change
        event(new Registered($user));

        if (! $household->on_duty_user_id) {
            $household->update(['on_duty_user_id' => $user->id]);
        }

        if ($invite) {
            HouseholdTouched::send($household->id, 'partner', toOthers: false);
        }

        return response()->json([
            'token' => $user->createToken('app')->plainTextToken,
            'joinedPartner' => (bool) $invite,
        ], 201);
    }

    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $user = User::where('email', strtolower($data['email']))->first();
        if (! $user || ! Hash::check($data['password'], $user->password)) {
            throw ValidationException::withMessages(['email' => ['These details don’t match a log we know.']]);
        }

        return response()->json(['token' => $user->createToken('app')->plainTextToken]);
    }

    public function forgotPassword(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'email']]);

        // self-hosters without SMTP get a clear machine-readable state, not an
        // error — the client turns it into friendly copy
        if (! AppMail::configured()) {
            return response()->json(['sent' => false, 'reason' => 'mail-unconfigured']);
        }

        Password::sendResetLink(
            ['email' => strtolower($data['email'])],
            function (User $user, string $token) {
                Mail::to($user->email)->send(new PasswordResetLink($user->name, $user->email, $token));
            },
        );

        // whatever the broker said — never reveal whether the email has an account
        return response()->json(['sent' => true]);
    }

    public function resetPassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string'],
            'email' => ['required', 'email'],
            'password' => ['required', 'string', 'min:8'],
        ]);

        $status = Password::reset(
            ['email' => strtolower($data['email']), 'password' => $data['password'], 'token' => $data['token']],
            function (User $user, string $password) {
                $user->forceFill(['password' => $password])->save(); // hashed by the cast
                $user->tokens()->delete(); // old sessions die with the old password
            },
        );

        if ($status !== Password::PASSWORD_RESET) {
            throw ValidationException::withMessages([
                'email' => ['That reset link has expired or was already used — ask for a fresh one from “Forgot password?”.'],
            ]);
        }

        return response()->json(['ok' => true]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['ok' => true]);
    }
}
