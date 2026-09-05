<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace Tests\Feature;

use App\Contracts\MqttConnectionFactory;
use App\Models\Entry;
use App\Models\Household;
use App\Services\Mqtt\MqttCommandHandler;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\Support\BabylogTestHelpers;
use Tests\Support\FakeMqtt;
use Tests\TestCase;

/**
 * The Home Assistant / MQTT integration. Broker credentials must never leak
 * into /state; publishes must never fail a write; HA button presses must be
 * indistinguishable from PWA writes.
 */
class MqttIntegrationTest extends TestCase
{
    use BabylogTestHelpers;
    use RefreshDatabase;

    private FakeMqtt $mqtt;

    protected function setUp(): void
    {
        parent::setUp();
        $this->mqtt = new FakeMqtt;
        $this->app->instance(MqttConnectionFactory::class, $this->mqtt);
    }

    private function configure(string $token, array $overrides = []): void
    {
        $this->postJson('/api/integrations/mqtt', array_merge([
            'enabled' => true, 'host' => 'mqtt.local', 'port' => 1883,
            'username' => 'babylog', 'password' => 'hunter2',
        ], $overrides), $this->authed($token))->assertOk();
    }

    // ── settings endpoints ─────────────────────────────────────────────────

    public function test_parents_configure_caregivers_403_password_is_write_only(): void
    {
        [$ben, , $doula] = $this->threeMemberHousehold();

        $this->getJson('/api/integrations/mqtt', $this->authed($doula))->assertForbidden();
        $this->postJson('/api/integrations/mqtt', ['enabled' => true], $this->authed($doula))->assertForbidden();
        $this->postJson('/api/integrations/mqtt/test', [], $this->authed($doula))->assertForbidden();

        $this->configure($ben);

        $show = $this->getJson('/api/integrations/mqtt', $this->authed($ben))->assertOk()->json();
        $this->assertTrue($show['config']['hasPassword']);
        $this->assertArrayNotHasKey('password', $show['config']);

        // re-saving without a password keeps the stored one
        $this->postJson('/api/integrations/mqtt', [
            'enabled' => true, 'host' => 'mqtt.local', 'username' => 'babylog',
        ], $this->authed($ben))->assertOk();
        $this->assertSame('hunter2', Household::first()->mqtt_config['password']);
    }

    public function test_state_never_leaks_broker_config(): void
    {
        [$ben] = $this->threeMemberHousehold();
        $this->configure($ben, ['host' => 'secret-broker.example', 'password' => 'sup3rs3cret']);

        $raw = $this->getJson('/api/state?since=0', $this->authed($ben))->assertOk()->content();
        $this->assertStringNotContainsString('secret-broker.example', $raw);
        $this->assertStringNotContainsString('sup3rs3cret', $raw);
        $this->assertStringNotContainsString('mqtt', strtolower($raw));
    }

    public function test_test_endpoint_reports_failure_without_persisting(): void
    {
        [$ben] = $this->threeMemberHousehold();
        $this->mqtt->failConnect = true;

        $result = $this->postJson('/api/integrations/mqtt/test', [
            'host' => 'nope.local',
        ], $this->authed($ben))->assertOk()->json();

        $this->assertFalse($result['ok']);
        $this->assertNull(Household::first()->mqtt_config);
    }

    // ── discovery + state publishing ───────────────────────────────────────

    public function test_enabling_publishes_device_discovery_and_state(): void
    {
        [$ben] = $this->threeMemberHousehold();
        $hid = Household::first()->id;
        $this->postJson('/api/baby', ['name' => 'Maddux'], $this->authed($ben))->assertOk();
        $this->postJson('/api/children', ['name' => 'Wren'], $this->authed($ben))->assertOk();

        $this->configure($ben);

        $hub = json_decode($this->mqtt->payloadFor("homeassistant/device/babylog_h{$hid}/config"), true);
        $this->assertSame('MyBabyNotes', $hub['dev']['name']);
        $this->assertSame('MyBabyNotes', $hub['o']['name']);
        $this->assertArrayHasKey('on_duty', $hub['cmps']);
        $this->assertArrayHasKey('btn_timer_stop', $hub['cmps']);

        $children = Household::first()->children;
        $wren = $children->firstWhere('name', 'Wren');
        $childCfg = json_decode($this->mqtt->payloadFor("homeassistant/device/babylog_h{$hid}_c{$wren->id}/config"), true);
        $this->assertSame('Wren (MyBabyNotes)', $childCfg['dev']['name']);
        $this->assertSame("babylog_h{$hid}", $childCfg['dev']['via_device']);
        $this->assertArrayHasKey('last_feeding', $childCfg['cmps']);
        $this->assertArrayHasKey('btn_log_wet', $childCfg['cmps']);
        $this->assertSame('timestamp', $childCfg['cmps']['last_feeding']['dev_cla']);

        // no entries yet → "None" state, retained
        $this->assertSame('None', $this->mqtt->payloadFor("babylog/{$hid}/c/{$wren->id}/feeding"));
    }

    public function test_a_pushed_entry_updates_state_topics_and_never_fails_the_write(): void
    {
        [$ben] = $this->threeMemberHousehold();
        $hid = Household::first()->id;
        $this->postJson('/api/baby', ['name' => 'Maddux'], $this->authed($ben))->assertOk();
        $this->configure($ben);
        $primary = Household::first()->children->first();

        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'b1', 'type' => 'bottle', 't' => 1757050000000, 'detail' => '4'],
        ]], $this->authed($ben))->assertOk();

        $iso = $this->mqtt->payloadFor("babylog/{$hid}/c/{$primary->id}/feeding");
        $this->assertSame(1757050000000, \Illuminate\Support\Carbon::parse($iso)->getTimestampMs());
        $attr = json_decode($this->mqtt->payloadFor("babylog/{$hid}/c/{$primary->id}/feeding/attr"), true);
        $this->assertSame('bottle', $attr['type']);
        $this->assertSame('4', $attr['detail']);
        $this->assertSame('Ben', $attr['by']);

        // broker dies → next write still 200s and the breaker trips
        $this->mqtt->failConnect = true;
        Cache::forget("mqtt:enabled:{$hid}"); // fresh check
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'b2', 'type' => 'wet', 't' => 1757050001000],
        ]], $this->authed($ben))->assertOk();
        $this->assertTrue((bool) Cache::get("mqtt:down:{$hid}"));
    }

    public function test_disabling_publishes_removal_payloads(): void
    {
        [$ben] = $this->threeMemberHousehold();
        $hid = Household::first()->id;
        $this->postJson('/api/baby', ['name' => 'Maddux'], $this->authed($ben))->assertOk();
        $this->configure($ben);

        $this->postJson('/api/integrations/mqtt', ['enabled' => false, 'host' => 'mqtt.local'], $this->authed($ben))->assertOk();

        $this->assertSame('', $this->mqtt->payloadFor("homeassistant/device/babylog_h{$hid}/config"));
        $this->assertSame('offline', $this->mqtt->payloadFor("babylog/{$hid}/availability"));
    }

    // ── command handler (HA button presses) ────────────────────────────────

    public function test_a_button_press_logs_an_entry_attributed_to_the_acting_user(): void
    {
        [$ben] = $this->threeMemberHousehold();
        $this->postJson('/api/baby', ['name' => 'Maddux'], $this->authed($ben))->assertOk();
        $this->configure($ben);
        $household = Household::with(['users', 'children'])->first();
        $primary = $household->children->first();

        app(MqttCommandHandler::class)->handle($household,
            json_encode(['action' => 'log', 'type' => 'wet', 'baby_id' => $primary->id]));

        $entry = Entry::query()->firstOrFail();
        $this->assertSame('wet', $entry->type);
        $this->assertSame($household->mqtt_config['acting_user_id'], $entry->user_id);
        $this->assertGreaterThan(0, $entry->rev); // syncs to phones like any write

        // foreign baby_id falls back to primary-child semantics (EntryWriter
        // defaults a create to the primary child), never a foreign write
        app(MqttCommandHandler::class)->handle($household,
            json_encode(['action' => 'log', 'type' => 'dirty', 'baby_id' => 999999]));
        $this->assertSame($primary->id, Entry::query()->where('type', 'dirty')->firstOrFail()->baby_id);

        // garbage is ignored
        app(MqttCommandHandler::class)->handle($household, 'not json at all');
        $this->assertSame(2, Entry::query()->count());
    }

    public function test_button_presses_drive_the_timer(): void
    {
        [$ben] = $this->threeMemberHousehold();
        $this->configure($ben);
        $household = Household::with(['users', 'children'])->first();

        app(MqttCommandHandler::class)->handle($household,
            json_encode(['action' => 'timer_start', 'type' => 'nurse']));
        $this->assertSame('nurse', $household->fresh()->runningTimers()[0]['type']);

        app(MqttCommandHandler::class)->handle($household->fresh(), json_encode(['action' => 'timer_stop']));
        $this->assertSame([], $household->fresh()->runningTimers());
    }

    // ── listener ───────────────────────────────────────────────────────────

    public function test_the_listener_connects_with_a_last_will_and_heartbeats(): void
    {
        [$ben] = $this->threeMemberHousehold();
        $hid = Household::first()->id;
        $this->configure($ben);
        $this->mqtt->connections = []; // forget the setup publishes

        $this->artisan('mqtt:listen --once')->assertSuccessful();

        $listener = collect($this->mqtt->connections)->first(fn ($c) => str_starts_with($c->clientId, 'babylog-listen-'));
        $this->assertNotNull($listener);
        $this->assertSame("babylog/{$hid}/availability", $listener->will['topic']);
        $this->assertSame('offline', $listener->will['payload']);
        $this->assertArrayHasKey("babylog/{$hid}/cmd", $listener->subscriptions);
        $this->assertNotNull(Cache::get("mqtt:heartbeat:{$hid}"));

        // a delivered command creates a real entry
        $listener->deliver("babylog/{$hid}/cmd", json_encode(['action' => 'log', 'type' => 'bath']));
        $this->assertSame('bath', Entry::query()->firstOrFail()->type);
    }

    public function test_the_listener_idles_quietly_with_nothing_configured(): void
    {
        $this->register('Ben', 'ben@example.com');

        $this->artisan('mqtt:listen --once')->assertSuccessful();
        $this->assertSame([], $this->mqtt->connections);
    }
}
