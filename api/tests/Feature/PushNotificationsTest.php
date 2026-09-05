<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace Tests\Feature;

use App\Models\PushSubscription;
use App\Services\PushService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\Support\FakePush;
use Tests\TestCase;

class PushNotificationsTest extends TestCase
{
    use RefreshDatabase;

    private FakePush $push;

    protected function setUp(): void
    {
        parent::setUp();
        $this->push = new FakePush;
        $this->app->instance(PushService::class, $this->push);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function register(string $name, string $email): string
    {
        return $this->postJson('/api/register', ['name' => $name, 'email' => $email, 'password' => 'password123'])->json('token');
    }

    private function authed(string $token): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$token];
    }

    /** Ben invites Katrina; returns [benToken, katToken, benId, katId]. */
    private function household(): array
    {
        $ben = $this->register('Ben', 'ben@example.com');
        $code = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $kat = $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code])->json('token');
        $benId = $this->getJson('/api/state', $this->authed($ben))->json('user.id');
        $katId = $this->getJson('/api/state', $this->authed($kat))->json('user.id');

        return [$ben, $kat, $benId, $katId];
    }

    private function subscribe(string $token, string $endpoint = 'https://push.example/device-1'): void
    {
        $this->postJson('/api/push/subscribe', [
            'endpoint' => $endpoint,
            'keys' => ['p256dh' => 'pk', 'auth' => 'at'],
            'tz' => 'UTC',
        ], $this->authed($token))->assertOk();
    }

    // ── subscriptions & prefs ─────────────────────────────────────────────────

    public function test_subscribe_upserts_by_endpoint_and_unsubscribe_removes(): void
    {
        [$ben, $kat, $benId, $katId] = $this->household();

        $this->subscribe($ben);
        $this->assertSame($benId, PushSubscription::sole()->user_id);

        // same device, partner logs in — the endpoint follows the current user
        $this->subscribe($kat);
        $this->assertSame($katId, PushSubscription::sole()->user_id);

        $this->postJson('/api/push/unsubscribe', ['endpoint' => 'https://push.example/device-1'], $this->authed($kat))->assertOk();
        $this->assertSame(0, PushSubscription::count());
    }

    public function test_vapid_subject_is_always_a_valid_uri_for_apple(): void
    {
        // an http/localhost APP_URL must not leak through as the VAPID sub —
        // Apple rejects it, silently killing iOS delivery
        config(['babylog.vapid_subject' => null, 'app.url' => 'http://localhost:3500']);
        $this->assertSame('mailto:babylog@localhost', (new \App\Services\PushService)->vapidSubject());

        // a real https origin is used as-is
        config(['app.url' => 'https://babylog.example.com']);
        $this->assertSame('https://babylog.example.com', (new \App\Services\PushService)->vapidSubject());

        // an explicit override wins
        config(['babylog.vapid_subject' => 'mailto:hi@example.com', 'app.url' => 'http://localhost:3500']);
        $this->assertSame('mailto:hi@example.com', (new \App\Services\PushService)->vapidSubject());
    }

    public function test_state_carries_vapid_key_and_default_prefs(): void
    {
        $ben = $this->register('Ben', 'ben@example.com');
        $state = $this->getJson('/api/state', $this->authed($ben))->assertOk()->json();

        $this->assertNotEmpty($state['vapidPublicKey']);
        $this->assertTrue($state['user']['notifyPrefs']['handoff']);
        $this->assertFalse($state['user']['notifyPrefs']['partner']);

        // the generated keypair is stable across requests
        $again = $this->getJson('/api/state', $this->authed($ben))->json('vapidPublicKey');
        $this->assertSame($state['vapidPublicKey'], $again);
    }

    public function test_notify_prefs_round_trip_and_validation(): void
    {
        $ben = $this->register('Ben', 'ben@example.com');

        $this->postJson('/api/notify-prefs', ['feed' => true, 'feedEvery' => 150, 'quiet' => true, 'tz' => 'America/New_York'], $this->authed($ben))->assertOk();
        $prefs = $this->getJson('/api/state', $this->authed($ben))->json('user.notifyPrefs');
        $this->assertTrue($prefs['feed']);
        $this->assertSame(150, $prefs['feedEvery']);
        $this->assertSame('America/New_York', $prefs['tz']);
        $this->assertTrue($prefs['handoff']); // untouched keys keep their defaults

        $this->postJson('/api/notify-prefs', ['feedEvery' => 999], $this->authed($ben))->assertStatus(422);
        $this->postJson('/api/notify-prefs', ['medsTime' => 'nope'], $this->authed($ben))->assertStatus(422);
        $this->postJson('/api/notify-prefs', ['tz' => 'Mars/Olympus'], $this->authed($ben))->assertStatus(422);
    }

    public function test_per_child_feed_interval_round_trips_and_survives_partial_posts(): void
    {
        $ben = $this->register('Ben', 'ben@example.com');
        $this->postJson('/api/baby', ['name' => 'Wren'], $this->authed($ben))->assertOk();
        $rileyId = $this->postJson('/api/children', ['name' => 'Riley'], $this->authed($ben))->json('child.id');

        $this->postJson('/api/notify-prefs', ['feed' => true, 'feedEveryByChild' => [(string) $rileyId => 120]], $this->authed($ben))->assertOk();
        $prefs = $this->getJson('/api/state', $this->authed($ben))->json('user.notifyPrefs');
        $this->assertSame([$rileyId => 120], $prefs['feedEveryByChild']);

        // a later partial POST that doesn't mention the map leaves it intact
        $this->postJson('/api/notify-prefs', ['feedEvery' => 180], $this->authed($ben))->assertOk();
        $prefs = $this->getJson('/api/state', $this->authed($ben))->json('user.notifyPrefs');
        $this->assertSame([$rileyId => 120], $prefs['feedEveryByChild']);
        $this->assertSame(180, $prefs['feedEvery']);

        // bad values and bad shapes are 422s
        $this->postJson('/api/notify-prefs', ['feedEveryByChild' => [(string) $rileyId => 999]], $this->authed($ben))->assertStatus(422);
        $this->postJson('/api/notify-prefs', ['feedEveryByChild' => 'nope'], $this->authed($ben))->assertStatus(422);

        // a key for a child outside the household is silently dropped, not stored
        $this->postJson('/api/notify-prefs', ['feedEveryByChild' => ['9999' => 150, (string) $rileyId => 240]], $this->authed($ben))->assertOk();
        $prefs = $this->getJson('/api/state', $this->authed($ben))->json('user.notifyPrefs');
        $this->assertSame([$rileyId => 240], $prefs['feedEveryByChild']);

        // sending the map without a child's key clears that override
        $this->postJson('/api/notify-prefs', ['feedEveryByChild' => []], $this->authed($ben))->assertOk();
        $prefs = $this->getJson('/api/state', $this->authed($ben))->json('user.notifyPrefs');
        $this->assertSame([], $prefs['feedEveryByChild']);
    }

    // ── handoff pushes ────────────────────────────────────────────────────────

    public function test_shift_events_push_the_partner(): void
    {
        [$ben, $kat, $benId, $katId] = $this->household();

        $this->postJson('/api/shifts/request', ['note' => 'need sleep'], $this->authed($ben))->assertOk();
        $this->assertCount(1, $this->push->to($katId));
        $this->assertSame('need sleep', $this->push->to($katId)[0]['body']);
        $this->assertCount(0, $this->push->to($benId));

        $this->postJson('/api/shifts/accept', ['plan' => [], 'until' => 'Until 6 AM'], $this->authed($kat))->assertOk();
        $this->assertCount(1, $this->push->to($benId));
        $this->assertStringContainsString('you’re covered', $this->push->to($benId)[0]['title']);

        $this->postJson('/api/shifts/handback', ['note' => 'went fine'], $this->authed($kat))->assertOk();
        $this->assertCount(2, $this->push->to($benId));
        $this->assertSame('went fine', $this->push->to($benId)[1]['body']);
    }

    public function test_asking_again_nudges_the_partner(): void
    {
        [$ben, $kat, , $katId] = $this->household();

        $this->postJson('/api/shifts/request', ['note' => 'first ask'], $this->authed($ben))->assertOk();
        // a second ask while the first is pending used to be a silent no-op
        $this->postJson('/api/shifts/request', ['note' => 'still need you'], $this->authed($ben))->assertOk();

        $this->assertCount(2, $this->push->to($katId));
        $this->assertSame('still need you', $this->push->to($katId)[1]['body']);
        $this->assertSame('still need you', $this->getJson('/api/state', $this->authed($kat))->json('shift.note'));
    }

    public function test_handoff_push_respects_the_pref(): void
    {
        [$ben, $kat, , $katId] = $this->household();

        $this->postJson('/api/notify-prefs', ['handoff' => false], $this->authed($kat))->assertOk();
        $this->postJson('/api/shifts/request', ['note' => 'need sleep'], $this->authed($ben))->assertOk();

        $this->assertCount(0, $this->push->sent);
    }

    // ── nursing / pump timers ─────────────────────────────────────────────────

    public function test_starting_a_timer_pings_the_partner(): void
    {
        [$ben, $kat, $benId, $katId] = $this->household();

        // on by default — Katrina learns Ben started nursing
        $this->postJson('/api/timer/start', ['type' => 'nurse'], $this->authed($ben))->assertOk();
        $this->assertCount(1, $this->push->to($katId));
        $this->assertStringContainsString('started nursing', $this->push->to($katId)[0]['title']);
        $this->assertCount(0, $this->push->to($benId)); // starter isn't pinged

        // stopping is quiet (the logged entry handles any partner-activity ping)
        $this->postJson('/api/timer/stop', [], $this->authed($ben))->assertOk();
        $this->assertCount(1, $this->push->to($katId));

        // pref off → silence
        $this->postJson('/api/notify-prefs', ['timer' => false], $this->authed($kat))->assertOk();
        $this->postJson('/api/timer/start', ['type' => 'pump'], $this->authed($ben))->assertOk();
        $this->assertCount(1, $this->push->to($katId));
    }

    public function test_timer_push_names_the_child_only_with_multiple_children(): void
    {
        [$ben, $kat, , $katId] = $this->household();
        $this->postJson('/api/baby', ['name' => 'Wren'], $this->authed($ben))->assertOk();

        // one child: copy unchanged — nothing to disambiguate
        $this->postJson('/api/timer/start', ['type' => 'nurse'], $this->authed($ben))->assertOk();
        $this->assertSame('Ben started nursing', $this->push->to($katId)[0]['title']);

        // a second child appears: an explicit baby_id is named…
        $rileyId = $this->postJson('/api/children', ['name' => 'Riley'], $this->authed($ben))->assertOk()->json('child.id');
        $this->postJson('/api/timer/start', ['type' => 'nurse', 'baby_id' => $rileyId], $this->authed($ben))->assertOk();
        $this->assertSame('Ben started nursing for Riley', $this->push->to($katId)[1]['title']);

        // …and an omitted baby_id names the primary child (old-client default)
        $this->postJson('/api/timer/start', ['type' => 'pump'], $this->authed($ben))->assertOk();
        $this->assertSame('Ben started pumping for Wren', $this->push->to($katId)[2]['title']);

        // archiving back down to one visible child drops the name again
        $this->postJson('/api/children', ['id' => $rileyId, 'name' => 'Riley', 'archived' => true], $this->authed($ben))->assertOk();
        $this->postJson('/api/timer/start', ['type' => 'sleep'], $this->authed($ben))->assertOk();
        $this->assertSame('Ben started a sleep timer', $this->push->to($katId)[3]['title']);
    }

    // ── partner activity ──────────────────────────────────────────────────────

    public function test_partner_activity_is_opt_in_and_throttled(): void
    {
        [$ben, $kat, , $katId] = $this->household();

        // off by default
        $this->postJson('/api/entries', ['entries' => [['id' => 'e1', 'type' => 'bottle', 't' => now()->getTimestampMs(), 'detail' => '4']]], $this->authed($ben))->assertOk();
        $this->assertCount(0, $this->push->sent);

        $this->postJson('/api/notify-prefs', ['partner' => true], $this->authed($kat))->assertOk();
        $this->postJson('/api/entries', ['entries' => [['id' => 'e2', 'type' => 'bottle', 't' => now()->getTimestampMs(), 'detail' => '4 breastmilk']]], $this->authed($ben))->assertOk();
        $this->assertCount(1, $this->push->to($katId));
        $this->assertSame('Ben logged a bottle', $this->push->to($katId)[0]['title']);

        // a second batch right after is swallowed by the 10-minute throttle
        $this->postJson('/api/entries', ['entries' => [['id' => 'e3', 'type' => 'wet', 't' => now()->getTimestampMs()]]], $this->authed($ben))->assertOk();
        $this->assertCount(1, $this->push->to($katId));

        // a delete-only batch never pings
        Carbon::setTestNow(now()->addMinutes(20));
        $this->postJson('/api/entries', ['entries' => [['id' => 'e2', 'type' => 'bottle', 't' => 1000, 'deleted' => true]]], $this->authed($ben))->assertOk();
        $this->assertCount(1, $this->push->to($katId));
    }

    // ── scheduled reminders ───────────────────────────────────────────────────

    public function test_feed_reminder_fires_once_per_overdue_feed(): void
    {
        $ben = $this->register('Ben', 'ben@example.com');
        $benId = $this->getJson('/api/state', $this->authed($ben))->json('user.id');
        $this->subscribe($ben);
        $this->postJson('/api/baby', ['name' => 'Wren'], $this->authed($ben));
        $this->postJson('/api/notify-prefs', ['feed' => true, 'feedEvery' => 120], $this->authed($ben))->assertOk();
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'f1', 'type' => 'bottle', 't' => now()->getTimestampMs() - 3 * 3600000, 'detail' => '4'],
        ]], $this->authed($ben))->assertOk();

        $this->artisan('babylog:reminders')->assertSuccessful();
        $this->assertCount(1, $this->push->to($benId));
        $this->assertStringContainsString('Wren', $this->push->to($benId)[0]['title']);

        // second tick: same overdue feed, no second nudge
        $this->artisan('babylog:reminders')->assertSuccessful();
        $this->assertCount(1, $this->push->to($benId));

        // a fresh feed resets the cycle and nothing is due
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'f2', 'type' => 'nurse', 't' => now()->getTimestampMs() - 10 * 60000],
        ]], $this->authed($ben))->assertOk();
        $this->artisan('babylog:reminders')->assertSuccessful();
        $this->assertCount(1, $this->push->to($benId));
    }

    public function test_per_child_feed_override_fires_only_for_the_overridden_child(): void
    {
        $ben = $this->register('Ben', 'ben@example.com');
        $benId = $this->getJson('/api/state', $this->authed($ben))->json('user.id');
        $this->subscribe($ben);
        $this->postJson('/api/baby', ['name' => 'Wren'], $this->authed($ben))->assertOk();
        $rileyId = $this->postJson('/api/children', ['name' => 'Riley'], $this->authed($ben))->json('child.id');

        // Riley is overridden to every 2h; Wren inherits the global 4h
        $this->postJson('/api/notify-prefs', [
            'feed' => true, 'feedEvery' => 240,
            'feedEveryByChild' => [(string) $rileyId => 120],
        ], $this->authed($ben))->assertOk();

        // both children last fed 3 hours ago — hand-written: 3h = 10800000 ms.
        // Riley (2h window) is an hour overdue; Wren (4h window) has an hour to go.
        $threeHoursAgo = now()->getTimestampMs() - 10800000;
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'fw1', 'type' => 'bottle', 't' => $threeHoursAgo, 'detail' => '4'], // no baby_id → Wren (primary)
            ['id' => 'fr1', 'type' => 'bottle', 't' => $threeHoursAgo, 'detail' => '4', 'baby_id' => $rileyId],
        ]], $this->authed($ben))->assertOk();

        $this->artisan('babylog:reminders')->assertSuccessful();
        $this->assertCount(1, $this->push->to($benId));
        $this->assertStringContainsString('Riley', $this->push->to($benId)[0]['title']);

        // second tick: still just the one nudge, and still nothing for Wren
        $this->artisan('babylog:reminders')->assertSuccessful();
        $this->assertCount(1, $this->push->to($benId));
    }

    public function test_feed_reminder_respects_quiet_hours_and_duty(): void
    {
        [$ben, $kat, $benId, $katId] = $this->household();
        $this->subscribe($ben, 'https://push.example/ben');
        $this->subscribe($kat, 'https://push.example/kat');
        $overdue = [['id' => 'f1', 'type' => 'bottle', 't' => now()->getTimestampMs() - 3 * 3600000, 'detail' => '4']];
        $this->postJson('/api/entries', ['entries' => $overdue], $this->authed($ben))->assertOk();

        // Katrina: reminders on but quiet hours cover the whole day
        $this->postJson('/api/notify-prefs', ['feed' => true, 'feedEvery' => 120, 'onDutyOnly' => false, 'quiet' => true, 'quietStart' => '00:00', 'quietEnd' => '23:59'], $this->authed($kat))->assertOk();
        // Ben: reminders on, but he's letting only the on-duty parent get them — and Ben is on duty
        $this->postJson('/api/notify-prefs', ['feed' => true, 'feedEvery' => 120], $this->authed($ben))->assertOk();
        // move duty to Katrina so Ben's onDutyOnly filter applies
        $this->postJson('/api/shifts/accept', ['plan' => []], $this->authed($kat))->assertOk();
        $this->push->sent = []; // drop the handoff push from the setup

        $this->artisan('babylog:reminders')->assertSuccessful();
        $this->assertCount(0, $this->push->sent);
    }

    public function test_wake_reminder_uses_age_typical_window(): void
    {
        $ben = $this->register('Ben', 'ben@example.com');
        $benId = $this->getJson('/api/state', $this->authed($ben))->json('user.id');
        $this->subscribe($ben);
        // ten weeks old → typical max wake ~90m
        $this->postJson('/api/baby', ['name' => 'Wren', 'birthdate' => now()->subWeeks(10)->format('Y-m-d')], $this->authed($ben));
        $this->postJson('/api/notify-prefs', ['wake' => true], $this->authed($ben))->assertOk();
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 's1', 'type' => 'sleep', 't' => now()->getTimestampMs() - 2 * 3600000, 'detail' => '45'],
        ]], $this->authed($ben))->assertOk();

        $this->artisan('babylog:reminders')->assertSuccessful();
        $this->assertCount(1, $this->push->to($benId));
        $this->assertSame('wake', $this->push->to($benId)[0]['tag']);

        $this->artisan('babylog:reminders')->assertSuccessful();
        $this->assertCount(1, $this->push->to($benId)); // once per nap
    }

    public function test_meds_reminder_fires_daily_unless_logged(): void
    {
        $ben = $this->register('Ben', 'ben@example.com');
        $benId = $this->getJson('/api/state', $this->authed($ben))->json('user.id');
        $this->subscribe($ben);
        $this->postJson('/api/notify-prefs', ['meds' => true, 'medsTime' => '00:00'], $this->authed($ben))->assertOk();

        $this->artisan('babylog:reminders')->assertSuccessful();
        $this->assertCount(1, $this->push->to($benId));

        $this->artisan('babylog:reminders')->assertSuccessful();
        $this->assertCount(1, $this->push->to($benId)); // once per day

        // next day, with meds already logged → decided quietly, no push
        Carbon::setTestNow(now()->addDay());
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'm1', 'type' => 'meds', 't' => now()->getTimestampMs()],
        ]], $this->authed($ben))->assertOk();
        $this->artisan('babylog:reminders')->assertSuccessful();
        $this->assertCount(1, $this->push->to($benId));
    }
}
