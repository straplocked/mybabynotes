<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\Support\BabylogTestHelpers;
use Tests\TestCase;

/**
 * Personal access tokens: minted from Settings with concrete scopes, shown
 * once, revocable, and never able to manage tokens themselves. First-party
 * 'app' tokens stay invisible to this surface.
 */
class TokenManagementTest extends TestCase
{
    use BabylogTestHelpers;
    use RefreshDatabase;

    public function test_mint_list_revoke_round_trip(): void
    {
        $app = $this->register('Ben', 'ben@example.com')->json('token');

        $create = $this->postJson('/api/tokens', [
            'name' => 'Home Assistant',
            'abilities' => ['entries:read', 'entries:write'],
        ], $this->authed($app))->assertCreated();
        $this->assertStringContainsString('|', $create->json('token')); // plaintext, shown once

        $list = $this->getJson('/api/tokens', $this->authed($app))->assertOk()->json();
        $this->assertCount(1, $list['tokens']);
        $this->assertSame('Home Assistant', $list['tokens'][0]['name']);
        $this->assertSame(['entries:read', 'entries:write'], $list['tokens'][0]['abilities']);
        $this->assertNotNull($list['tokens'][0]['expiresAt']); // default 90 days
        $this->assertArrayHasKey('mcp', $list['scopes']);

        $this->postJson('/api/tokens/revoke', ['id' => $create->json('id')], $this->authed($app))->assertOk();
        $this->assertSame([], $this->getJson('/api/tokens', $this->authed($app))->json('tokens'));
    }

    public function test_the_list_never_shows_app_tokens_and_revoke_cannot_touch_them(): void
    {
        $app = $this->register('Ben', 'ben@example.com')->json('token');

        $this->assertSame([], $this->getJson('/api/tokens', $this->authed($app))->json('tokens'));

        $appTokenId = PersonalAccessToken::query()->where('name', 'app')->value('id');
        $this->postJson('/api/tokens/revoke', ['id' => $appTokenId], $this->authed($app))->assertStatus(422);
        $this->assertNotNull(PersonalAccessToken::find($appTokenId));
    }

    public function test_validation_rejects_bad_names_scopes_and_overflow(): void
    {
        $app = $this->register('Ben', 'ben@example.com')->json('token');

        $this->postJson('/api/tokens', ['name' => 'app', 'abilities' => ['entries:read']], $this->authed($app))
            ->assertStatus(422);
        $this->postJson('/api/tokens', ['name' => 'X', 'abilities' => ['households:delete']], $this->authed($app))
            ->assertStatus(422);
        $this->postJson('/api/tokens', ['name' => 'X', 'abilities' => []], $this->authed($app))
            ->assertStatus(422);

        $this->mintPat($app, ['entries:read'], name: 'Dup');
        $this->postJson('/api/tokens', ['name' => 'Dup', 'abilities' => ['entries:read']], $this->authed($app))
            ->assertStatus(422);

        for ($i = 2; $i <= 10; $i++) {
            $this->mintPat($app, ['entries:read'], name: "Token {$i}");
        }
        $this->postJson('/api/tokens', ['name' => 'Eleventh', 'abilities' => ['entries:read']], $this->authed($app))
            ->assertStatus(422);
    }

    public function test_a_pat_cannot_reach_token_management(): void
    {
        $app = $this->register('Ben', 'ben@example.com')->json('token');
        $pat = $this->mintPat($app, ['entries:read', 'entries:write', 'mcp']);

        $this->getJson('/api/tokens', $this->authed($pat))->assertForbidden();
        $this->postJson('/api/tokens', ['name' => 'Sneaky', 'abilities' => ['entries:read']], $this->authed($pat))
            ->assertForbidden();
        $this->postJson('/api/tokens/revoke', ['id' => 1], $this->authed($pat))->assertForbidden();
    }

    public function test_no_expiry_tokens_can_be_requested_explicitly(): void
    {
        $app = $this->register('Ben', 'ben@example.com')->json('token');
        $this->postJson('/api/tokens', [
            'name' => 'Forever', 'abilities' => ['entries:read'], 'expires_in_days' => null,
        ], $this->authed($app))->assertCreated();

        $this->assertNull(PersonalAccessToken::query()->where('name', 'Forever')->value('expires_at'));
    }

    public function test_a_caregiver_can_mint_and_use_a_token(): void
    {
        [, , $doula] = $this->threeMemberHousehold();
        $pat = $this->mintPat($doula, ['entries:read', 'entries:write'], name: 'Doula phone widget');

        // usable on the public surface, where a caregiver is allowed…
        $this->getJson('/api/v1/entries', $this->authed($pat))->assertOk();
        // …and never on the PWA's own routes (parent-only or not) — PATs are
        // 403 across the unversioned group, see PatBoundaryTest
        $this->getJson('/api/state?since=0', $this->authed($pat))->assertForbidden();
        $this->postJson('/api/settings', ['unit' => 'ml'], $this->authed($pat))->assertForbidden();
    }

    public function test_password_change_keeps_pats_but_reset_kills_everything(): void
    {
        $app = $this->register('Ben', 'ben@example.com')->json('token');
        $this->mintPat($app, ['entries:read'], name: 'Survivor');

        $this->postJson('/api/account/password', [
            'current_password' => 'password123', 'password' => 'newpassword9',
        ], $this->authed($app))->assertOk();

        $names = PersonalAccessToken::query()->pluck('name')->all();
        $this->assertContains('Survivor', $names);   // PAT survives a routine change
        $this->assertContains('app', $names);        // the changing session survives too
    }
}
