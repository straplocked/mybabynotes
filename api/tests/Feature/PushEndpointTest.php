<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace Tests\Feature;

use App\Contracts\HostResolver;
use App\Models\PushSubscription;
use App\Rules\PublicHttpsUrl;
use App\Services\PushService;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use Illuminate\Foundation\Http\Events\RequestHandled;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Minishlink\WebPush\VAPID;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\FakeHostResolver;
use Tests\TestCase;

/**
 * /push/subscribe hands the server a URL it will POST to later on the user's
 * word. Two guards: the URL has to be a public https address (not the LAN,
 * loopback, or a cloud metadata range — see App\Rules\PublicHttpsUrl), and
 * the POST itself happens after the partner's response has gone out, so a
 * slow endpoint can't hold a write.
 */
class PushEndpointTest extends TestCase
{
    use RefreshDatabase;

    private function register(string $name, string $email): string
    {
        return $this->postJson('/api/register', ['name' => $name, 'email' => $email, 'password' => 'password123'])->json('token');
    }

    private function authed(string $token): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$token];
    }

    private function subscribe(string $token, string $endpoint): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/push/subscribe', [
            'endpoint' => $endpoint,
            'keys' => ['p256dh' => 'pk', 'auth' => 'at'],
        ], $this->authed($token));
    }

    // ── endpoint validation ──────────────────────────────────────────────────

    public static function rejectedEndpoints(): array
    {
        return [
            'loopback v4' => ['https://127.0.0.1/x'],
            'private 10/8' => ['https://10.1.2.3/x'],
            'private 172.16/12' => ['https://172.31.255.1/x'],
            'private 192.168/16' => ['https://192.168.1.10/x'],
            'link-local / metadata' => ['https://169.254.169.254/latest/meta-data'],
            'cgnat' => ['https://100.64.0.1/x'],
            'loopback v6' => ['https://[::1]/x'],
            'ula v6' => ['https://[fd12:3456::1]/x'],
            'link-local v6' => ['https://[fe80::1]/x'],
            'v4-mapped loopback' => ['https://[::ffff:127.0.0.1]/x'],
            'v4-mapped private' => ['https://[::ffff:10.0.0.9]/x'],
            'plain http, even to a real vendor' => ['http://fcm.googleapis.com/fcm/send/abc'],
            'localhost' => ['https://localhost/x'],
            'mdns .local' => ['https://nas.local/x'],
            '.internal' => ['https://push.internal/x'],
            '.localhost' => ['https://push.localhost/x'],
            'single label' => ['https://push/x'],
            'unresolvable host' => ['https://does-not-resolve.example/x'],
        ];
    }

    #[DataProvider('rejectedEndpoints')]
    public function test_subscribe_rejects_a_non_public_endpoint(string $endpoint): void
    {
        $ben = $this->register('Ben', 'ben@example.com');

        $this->subscribe($ben, $endpoint)
            ->assertStatus(422)
            ->assertJsonPath('errors.endpoint.0', 'Push endpoint must be a public https URL.');
        $this->assertSame(0, PushSubscription::count());
    }

    public function test_a_hostname_is_judged_by_what_it_resolves_to(): void
    {
        $ben = $this->register('Ben', 'ben@example.com');

        // a public name that answers with a LAN address is a LAN relay
        $this->app->instance(HostResolver::class, new FakeHostResolver(['relay.example' => ['10.0.0.5']]));
        $this->subscribe($ben, 'https://relay.example/x')->assertStatus(422);

        // one public record among the answers isn't enough — every address must be public
        $this->app->instance(HostResolver::class, new FakeHostResolver(['relay.example' => ['203.0.113.7', '192.168.0.2']]));
        $this->subscribe($ben, 'https://relay.example/x')->assertStatus(422);
        $this->assertSame(0, PushSubscription::count());

        // the same host resolving publicly (v4 and v6) is a fine self-hosted relay
        $this->app->instance(HostResolver::class, new FakeHostResolver(['relay.example' => ['203.0.113.7', '2001:db8::7']]));
        $this->subscribe($ben, 'https://relay.example/x')->assertOk();
        $this->assertSame('https://relay.example/x', PushSubscription::sole()->endpoint);
    }

    public function test_the_usual_vendors_pass_as_public_addresses(): void
    {
        $ben = $this->register('Ben', 'ben@example.com');
        $this->app->instance(HostResolver::class, new FakeHostResolver([
            'fcm.googleapis.com' => ['142.250.72.10', '2607:f8b0:4005:80b::200a'],
            'web.push.apple.com' => ['17.253.15.200'],
        ]));

        $this->subscribe($ben, 'https://fcm.googleapis.com/fcm/send/abc')->assertOk();
        $this->subscribe($ben, 'https://web.push.apple.com/QAbc')->assertOk();
        $this->assertSame(2, PushSubscription::count());
    }

    public function test_ip_range_table_reads_as_intended(): void
    {
        // hand-written expectations — this is the table the rule stands on
        foreach (['0.0.0.0', '10.255.255.255', '100.64.0.1', '100.127.255.255', '127.0.0.1', '169.254.0.1', '172.16.0.1', '172.31.255.255', '192.168.0.1', '224.0.0.1', '255.255.255.255',
            '::', '::1', 'fc00::1', 'fdff::1', 'fe80::1', 'febf::1', 'ff02::1', '::ffff:192.168.1.1', '64:ff9b::10.0.0.1'] as $ip) {
            $this->assertTrue(PublicHttpsUrl::isNonPublicIp($ip), "$ip should be non-public");
        }
        foreach (['100.63.255.255', '100.128.0.0', '172.15.255.255', '172.32.0.0', '8.8.8.8', '203.0.113.7', '2001:db8::1', 'fec0::1', '::ffff:8.8.8.8'] as $ip) {
            $this->assertFalse(PublicHttpsUrl::isNonPublicIp($ip), "$ip should be public");
        }
    }

    // ── send timing ──────────────────────────────────────────────────────────

    public function test_a_partner_activity_push_goes_out_after_the_response_not_inside_it(): void
    {
        // the real PushService with a real VAPID keypair and real payload
        // encryption; only the HTTP hop is a mock that records when it ran
        $order = [];
        $mock = new MockHandler([function () use (&$order) {
            $order[] = 'push';

            return new Response(201);
        }]);
        $this->app->instance(PushService::class, new PushService(new Client(['handler' => HandlerStack::create($mock)])));
        Event::listen(RequestHandled::class, function () use (&$order) {
            $order[] = 'response';
        });

        $ben = $this->register('Ben', 'ben@example.com');
        $code = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $kat = $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code])->json('token');
        $keys = VAPID::createVapidKeys(); // a P-256 keypair: its public half is a valid p256dh
        $this->postJson('/api/push/subscribe', [
            'endpoint' => 'https://push.example/kat',
            'keys' => ['p256dh' => $keys['publicKey'], 'auth' => rtrim(strtr(base64_encode(random_bytes(16)), '+/', '-_'), '=')],
        ], $this->authed($kat))->assertOk();
        $this->postJson('/api/notify-prefs', ['partner' => true], $this->authed($kat))->assertOk();
        $order = [];

        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'e1', 'type' => 'bottle', 't' => now()->getTimestampMs(), 'detail' => '4'],
        ]], $this->authed($ben))->assertOk();

        // handle() built and dispatched the response; the send ran in terminate()
        $this->assertSame(['response', 'push'], $order);
        $this->assertNotNull($mock->getLastRequest());
        $this->assertSame('https://push.example/kat', (string) $mock->getLastRequest()->getUri());
    }

    public function test_console_sends_inline_and_a_request_buffers_until_flush(): void
    {
        $sent = [];
        $mock = new MockHandler([
            function () use (&$sent) { $sent[] = 1; return new Response(201); },
            function () use (&$sent) { $sent[] = 2; return new Response(201); },
        ]);
        $push = new PushService(new Client(['handler' => HandlerStack::create($mock)]));
        $ben = $this->register('Ben', 'ben@example.com');
        $keys = VAPID::createVapidKeys();
        $this->postJson('/api/push/subscribe', [
            'endpoint' => 'https://push.example/ben',
            'keys' => ['p256dh' => $keys['publicKey'], 'auth' => rtrim(strtr(base64_encode(random_bytes(16)), '+/', '-_'), '=')],
        ], $this->authed($ben))->assertOk();
        $user = \App\Models\User::sole();

        // no middleware ran on this instance — the console path — so it sends now
        $push->notify($user, 'meds', ['Meds time'], ['Nothing logged for :name yet today.', ['name' => 'Wren']]);
        $this->assertSame([1], $sent);

        // once a request has flipped it, notify() only buffers …
        $push->deferUntilTerminate();
        $push->notify($user, 'meds', ['Meds time'], ['Nothing logged for :name yet today.', ['name' => 'Wren']]);
        $this->assertSame([1], $sent);

        // … and flush() ships it
        $push->flush();
        $this->assertSame([1, 2], $sent);
    }
}
