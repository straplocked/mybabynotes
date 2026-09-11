<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace Tests\Feature;

use App\Support\ApiScopes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Tests\Support\BabylogTestHelpers;
use Tests\TestCase;

/**
 * Personal access tokens stop at the public surface. The unversioned /api/*
 * group and the broadcasting auth route carry abilities:*, which only the
 * first-party 'app' login token has — a PAT is 403 there no matter how many
 * scopes it holds, because '*' is not a scope it can ask for.
 */
class PatBoundaryTest extends TestCase
{
    use BabylogTestHelpers;
    use RefreshDatabase;

    /** The four routes anyone may call without a token. */
    private const PUBLIC = ['api/register', 'api/login', 'api/forgot-password', 'api/reset-password'];

    /** Routes a scoped PAT used to reach; every one must now be 403. */
    private function probes(string $token): array
    {
        $h = fn () => $this->authed($token);

        return [
            'GET /api/state' => fn () => $this->getJson('/api/state?since=0', $h()),
            'POST /api/invite' => fn () => $this->postJson('/api/invite', ['email' => 'x@example.com'], $h()),
            'POST /api/household/remove-member' => fn () => $this->postJson('/api/household/remove-member', ['user_id' => 999], $h()),
            'POST /api/settings' => fn () => $this->postJson('/api/settings', ['unit' => 'ml'], $h()),
            'GET /api/integrations/mqtt' => fn () => $this->getJson('/api/integrations/mqtt', $h()),
            'POST /api/entries' => fn () => $this->postJson('/api/entries', ['entries' => []], $h()),
            'POST /api/broadcasting/auth' => fn () => $this->postJson('/api/broadcasting/auth', [
                'channel_name' => 'private-household.1', 'socket_id' => '1234.5678',
            ], $h()),
        ];
    }

    public function test_a_scoped_pat_is_forbidden_where_the_app_token_is_not(): void
    {
        $app = $this->register('Ben', 'ben@example.com')->json('token');
        $pat = $this->mintPat($app, ['entries:read']);

        foreach ($this->probes($pat) as $label => $call) {
            $this->assertSame(403, $call()->status(), "$label let a scoped PAT through");
        }
        foreach ($this->probes($app) as $label => $call) {
            $status = $call()->status();
            $this->assertNotContains($status, [401, 403], "$label rejected the first-party app token ($status)");
        }
    }

    public function test_every_scope_at_once_is_still_not_the_app(): void
    {
        $app = $this->register('Ben', 'ben@example.com')->json('token');
        $pat = $this->mintPat($app, ApiScopes::keys(), name: 'Everything');

        // the gate keys on the '*' ability, not on how many scopes were granted
        $this->getJson('/api/state?since=0', $this->authed($pat))->assertForbidden();
        $this->getJson('/api/v1/me', $this->authed($pat))->assertOk(); // still a perfectly good PAT
    }

    public function test_star_is_not_a_scope_a_pat_can_request(): void
    {
        $app = $this->register('Ben', 'ben@example.com')->json('token');

        $this->assertNotContains('*', ApiScopes::keys());
        $this->postJson('/api/tokens', ['name' => 'Sneaky', 'abilities' => ['*']], $this->authed($app))
            ->assertStatus(422);
        $this->postJson('/api/tokens', ['name' => 'Sneaky', 'abilities' => ['entries:read', '*']], $this->authed($app))
            ->assertStatus(422);
    }

    public function test_a_pat_cannot_subscribe_to_the_household_channel(): void
    {
        $app = $this->register('Ben', 'ben@example.com')->json('token');
        $hh = $this->getJson('/api/state?since=0', $this->authed($app))->json('user.householdId');
        $this->assertNotNull($hh);
        $pat = $this->mintPat($app, ApiScopes::keys(), name: 'Everything');
        $body = ['channel_name' => "private-household.$hh", 'socket_id' => '1234.5678'];

        $this->postJson('/api/broadcasting/auth', $body, $this->authed($pat))->assertForbidden();
        // the PWA's Echo auth (the same request with the login token) still passes
        $this->postJson('/api/broadcasting/auth', $body, $this->authed($app))->assertOk();
    }

    /**
     * Sweep the registered routes so a future unversioned route can't be added
     * without the guard: everything under api/ that isn't v1 or one of the
     * four public routes must 403 a PAT carrying every scope.
     */
    public function test_every_unversioned_route_rejects_a_pat(): void
    {
        $app = $this->register('Ben', 'ben@example.com')->json('token');
        $pat = $this->mintPat($app, ApiScopes::keys(), name: 'Everything');

        $swept = [];
        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();
            if (! str_starts_with($uri, 'api/') || str_starts_with($uri, 'api/v1/') || in_array($uri, self::PUBLIC, true)) {
                continue;
            }
            foreach ($route->methods() as $method) {
                if (in_array($method, ['HEAD', 'OPTIONS'], true)) {
                    continue;
                }
                $status = $this->json($method, '/'.$uri, [], $this->authed($pat))->status();
                $this->assertSame(403, $status, "$method /$uri answered $status to a PAT");
                $swept[] = "$method /$uri";
            }
        }

        // hand-counted: 27 routes in the api.php group + GET and POST on
        // broadcasting/auth = 29. A floor, so an over-eager filter that
        // sweeps nothing can't pass by accident.
        $this->assertGreaterThanOrEqual(29, count($swept), implode("\n", $swept));
        $this->assertContains('GET /api/state', $swept);
        $this->assertContains('POST /api/broadcasting/auth', $swept);
    }
}
