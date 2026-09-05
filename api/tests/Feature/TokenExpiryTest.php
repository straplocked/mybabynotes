<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace Tests\Feature;

use App\Models\Household;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

/**
 * Sanctum's expiration counts from token creation; the AppServiceProvider
 * callback slides it to count from last use, so a phone in regular use never
 * re-sees the login screen while an idle device still ages out.
 */
class TokenExpiryTest extends TestCase
{
    use RefreshDatabase;

    /** A signed-in user whose token was created $createdDaysAgo, last used $usedDaysAgo. */
    private function agedToken(
        int $createdDaysAgo,
        ?int $usedDaysAgo,
        string $name = 'app',
        ?int $expiresDaysFromNow = null,
    ): string {
        $household = Household::create();
        $user = User::create([
            'name' => 'Ben', 'email' => 'ben'.uniqid().'@example.com', 'password' => 'password123',
            'household_id' => $household->id, 'role' => 'parent',
        ]);
        $plain = $user->createToken($name)->plainTextToken;
        $user->tokens()->latest('id')->first()->forceFill([
            'created_at' => now()->subDays($createdDaysAgo),
            'last_used_at' => $usedDaysAgo === null ? null : now()->subDays($usedDaysAgo),
            'expires_at' => $expiresDaysFromNow === null ? null : now()->addDays($expiresDaysFromNow),
        ])->save();

        return $plain;
    }

    public function test_an_actively_used_token_outlives_the_created_at_window(): void
    {
        $token = $this->agedToken(createdDaysAgo: 120, usedDaysAgo: 1);

        $this->getJson('/api/state?since=0', ['Authorization' => 'Bearer '.$token])->assertOk();
    }

    public function test_a_token_idle_past_the_window_expires(): void
    {
        $token = $this->agedToken(createdDaysAgo: 120, usedDaysAgo: 95);

        $this->getJson('/api/state?since=0', ['Authorization' => 'Bearer '.$token])->assertUnauthorized();
    }

    public function test_an_old_never_used_token_expires(): void
    {
        $token = $this->agedToken(createdDaysAgo: 120, usedDaysAgo: null);

        $this->getJson('/api/state?since=0', ['Authorization' => 'Bearer '.$token])->assertUnauthorized();
    }

    public function test_a_fresh_token_works_as_before(): void
    {
        $token = $this->agedToken(createdDaysAgo: 0, usedDaysAgo: null);

        $this->getJson('/api/state?since=0', ['Authorization' => 'Bearer '.$token])->assertOk();
    }

    // ── personal access tokens (any name but 'app') never slide ──

    public function test_a_pat_past_its_expiry_dies_even_while_in_use(): void
    {
        $token = $this->agedToken(createdDaysAgo: 40, usedDaysAgo: 0, name: 'Home Assistant', expiresDaysFromNow: -1);

        $this->getJson('/api/state?since=0', ['Authorization' => 'Bearer '.$token])->assertUnauthorized();
    }

    public function test_a_no_expiry_pat_outlives_the_sliding_window(): void
    {
        $token = $this->agedToken(createdDaysAgo: 120, usedDaysAgo: 100, name: 'Home Assistant');

        $this->getJson('/api/state?since=0', ['Authorization' => 'Bearer '.$token])->assertOk();
    }

    // ── babylog:prune-tokens respects both validity rules ──

    private function tokenCount(): int
    {
        return PersonalAccessToken::query()->count();
    }

    public function test_prune_keeps_an_old_but_active_app_token(): void
    {
        $this->agedToken(createdDaysAgo: 120, usedDaysAgo: 1);

        $this->artisan('babylog:prune-tokens');
        $this->assertSame(1, $this->tokenCount());
    }

    public function test_prune_reaps_an_app_token_idle_past_window_plus_grace(): void
    {
        $this->agedToken(createdDaysAgo: 200, usedDaysAgo: 98);
        $this->agedToken(createdDaysAgo: 200, usedDaysAgo: null);

        $this->artisan('babylog:prune-tokens');
        $this->assertSame(0, $this->tokenCount());
    }

    public function test_prune_reaps_a_pat_a_week_past_expiry_but_keeps_no_expiry_pats(): void
    {
        $this->agedToken(createdDaysAgo: 400, usedDaysAgo: 300, name: 'Old integration', expiresDaysFromNow: -8);
        $this->agedToken(createdDaysAgo: 400, usedDaysAgo: 300, name: 'Forever dashboard');
        $this->agedToken(createdDaysAgo: 30, usedDaysAgo: 1, name: 'Recently expired', expiresDaysFromNow: -2);

        $this->artisan('babylog:prune-tokens');

        $names = PersonalAccessToken::query()->pluck('name')->all();
        $this->assertEqualsCanonicalizing(['Forever dashboard', 'Recently expired'], $names);
    }
}
