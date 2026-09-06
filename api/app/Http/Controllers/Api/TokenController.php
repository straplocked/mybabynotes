<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\ApiScopes;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Personal access tokens for the public /api/v1 surface and MCP. First-party
 * app tokens are always named 'app' and never appear here; PATs are anything
 * else. Routes carry the abilities:* middleware so a PAT can never mint or
 * revoke PATs — management is a first-party-session-only act.
 */
class TokenController extends Controller
{
    private const MAX_TOKENS = 10;

    public function index(Request $request): JsonResponse
    {
        $tokens = $request->user()->tokens()
            ->where('name', '!=', 'app')
            ->orderBy('id')
            ->get()
            ->map(fn ($t) => [
                'id' => $t->id,
                'name' => $t->name,
                'abilities' => $t->abilities,
                'createdAt' => $t->created_at?->toIso8601String(),
                'lastUsedAt' => $t->last_used_at?->toIso8601String(),
                'expiresAt' => $t->expires_at?->toIso8601String(),
            ])->all();

        return response()->json(['tokens' => $tokens, 'scopes' => ApiScopes::SCOPES]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'name' => ['required', 'string', 'max:40', 'not_in:app'],
            'abilities' => ['required', 'array', 'min:1'],
            'abilities.*' => ['string', Rule::in(ApiScopes::keys())],
            'expires_in_days' => ['sometimes', 'nullable', 'integer', 'in:30,90,365'],
        ]);

        if ($user->tokens()->where('name', '!=', 'app')->count() >= self::MAX_TOKENS) {
            return response()->json(['message' => __('You already have :n tokens — revoke one first.', ['n' => self::MAX_TOKENS])], 422);
        }
        if ($user->tokens()->where('name', $data['name'])->exists()) {
            return response()->json(['message' => __('You already have a token with that name.')], 422);
        }

        // default 90 days; an explicit null means no expiry (the callback in
        // AppServiceProvider honors expires_at only — PATs never slide)
        $days = array_key_exists('expires_in_days', $data) ? $data['expires_in_days'] : 90;
        $token = $user->createToken(
            $data['name'],
            array_values(array_unique($data['abilities'])),
            $days === null ? null : now()->addDays((int) $days),
        );

        return response()->json([
            'ok' => true,
            'id' => $token->accessToken->id,
            // shown exactly once — only the hash is stored
            'token' => $token->plainTextToken,
        ], 201);
    }

    public function revoke(Request $request): JsonResponse
    {
        $data = $request->validate(['id' => ['required', 'integer']]);

        $deleted = $request->user()->tokens()
            ->where('name', '!=', 'app')
            ->where('id', $data['id'])
            ->delete();
        if (! $deleted) {
            return response()->json(['message' => __('That token doesn’t exist.')], 422);
        }

        return response()->json(['ok' => true]);
    }
}
