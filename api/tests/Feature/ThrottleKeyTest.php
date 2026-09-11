<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/**
 * What Laravel does with X-Forwarded-For — and therefore what every nginx
 * in front of php-fpm has to guarantee. trustProxies('*') makes the
 * framework believe the leftmost forwarded address from any peer, and the
 * auth throttles key on ip(), so whoever writes that header picks the
 * throttle bucket. That is why the root nginx.conf (proxy_set_header) and
 * deploy/aio/nginx.conf (fastcgi_param) both overwrite it with the peer
 * they actually saw before PHP ever sees the request. If these pins fail,
 * the trust model moved and those config comments need re-reading: in the
 * compose stack the api container's peer is always the app container, so
 * per-client throttling only works because the forwarded header is trusted.
 */
class ThrottleKeyTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // no route middleware on purpose — TrustProxies is global, and that
        // is the layer under test
        Route::get('/_client_ip', fn (Request $request) => $request->ip());
    }

    public function test_client_ip_is_taken_from_x_forwarded_for_when_present(): void
    {
        // the test kernel's peer is 127.0.0.1; no header means the peer
        $this->assertSame('127.0.0.1', $this->get('/_client_ip')->getContent());

        $this->assertSame(
            '203.0.113.9',
            $this->get('/_client_ip', ['X-Forwarded-For' => '203.0.113.9'])->getContent(),
        );

        // leftmost wins: a "client, proxy" chain resolves to the client, so a
        // client-authored value would survive an appending proxy
        $this->assertSame(
            '203.0.113.9',
            $this->get('/_client_ip', ['X-Forwarded-For' => '203.0.113.9, 10.0.0.2'])->getContent(),
        );
    }

    public function test_login_throttle_buckets_follow_the_forwarded_address(): void
    {
        $creds = ['email' => 'nobody@example.com', 'password' => 'not-the-password'];

        for ($i = 1; $i <= 10; $i++) {
            $this->postJson('/api/login', $creds, ['X-Forwarded-For' => '203.0.113.9'])->assertStatus(422);
        }
        $this->postJson('/api/login', $creds, ['X-Forwarded-For' => '203.0.113.9'])->assertStatus(429);

        // same peer, different forwarded address: a fresh bucket. This is the
        // hole nginx closes by owning the header — never let it reach PHP as
        // the client wrote it.
        $this->postJson('/api/login', $creds, ['X-Forwarded-For' => '203.0.113.10'])->assertStatus(422);

        // and with no header at all the peer address is its own bucket
        $this->postJson('/api/login', $creds)->assertStatus(422);
    }
}
