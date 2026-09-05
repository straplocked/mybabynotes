<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Services\Mqtt;

use App\Contracts\MqttConnectionFactory;
use App\Models\Household;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Fire-and-forget MQTT publication, hooked off HouseholdTouched::send(). Runs
 * inline on the request path (the queue is sync), so the rules are: bail
 * instantly for unconfigured households, never throw, and trip a 60s circuit
 * breaker after any failure so a dead broker costs one ~2s timeout per
 * minute, not one per write.
 */
class MqttPublisher
{
    private const RELEVANT = ['entries', 'timer', 'shift', 'children', 'baby', 'settings', 'members', 'account'];

    private const DISCOVERY_KINDS = ['children', 'baby', 'settings', 'members', 'account'];

    public function __construct(private MqttConnectionFactory $factory)
    {
    }

    public function publishForHousehold(int $householdId, string $kind): void
    {
        if (! in_array($kind, self::RELEVANT, true)) {
            return;
        }
        if (Cache::get("mqtt:down:{$householdId}")) {
            return;
        }
        // 60s memo of "is MQTT even on" so disabled instances pay one PK read
        // a minute at most; saving the settings form busts this key
        $enabled = Cache::remember(
            "mqtt:enabled:{$householdId}",
            60,
            fn () => (bool) (Household::find($householdId)?->mqtt_config['enabled'] ?? false),
        );
        if (! $enabled) {
            return;
        }

        $household = Household::with(['users', 'children'])->find($householdId);
        $config = $household?->mqtt_config;
        if (! $household || ! ($config['enabled'] ?? false)) {
            return;
        }

        $topology = new MqttTopology($household, $config);
        $messages = in_array($kind, self::DISCOVERY_KINDS, true)
            ? array_merge($topology->discoveryMessages(), $topology->allStateMessages())
            : match ($kind) {
                'entries' => $topology->entryStateMessages(),
                'timer' => $topology->timerStateMessages(),
                'shift' => $topology->onDutyStateMessages(),
            };

        $this->deliver($householdId, $config, $messages, 'pub');
    }

    /** Full resync (used on settings save and by the listener's heartbeat). */
    public function publishEverything(Household $household): void
    {
        $config = $household->mqtt_config;
        $topology = new MqttTopology($household, $config);
        $this->deliver(
            $household->id,
            $config,
            array_merge(
                $topology->discoveryMessages(),
                $topology->allStateMessages(),
                // web publishes may race the listener's LWT; retained online is
                // corrected by the LWT if the listener actually dies
                [['topic' => $topology->availabilityTopic(), 'payload' => 'online', 'retain' => true]],
            ),
            'setup',
        );
    }

    /** Remove every HA device (integration disabled or household gone). */
    public function publishRemoval(Household $household, array $config): void
    {
        $topology = new MqttTopology($household, $config);
        $this->deliver($household->id, $config, $topology->removalMessages(), 'remove');
    }

    private function deliver(int $householdId, array $config, array $messages, string $role): void
    {
        try {
            $connection = $this->factory->make($config, "babylog-{$role}-{$householdId}-".substr(md5(uniqid()), 0, 6));
            $connection->connect();
            foreach ($messages as $m) {
                $connection->publish($m['topic'], $m['payload'], $m['retain']);
            }
            $connection->disconnect();
        } catch (\Throwable $e) {
            Cache::put("mqtt:down:{$householdId}", true, 60);
            Log::info("MQTT publish skipped for household {$householdId}: {$e->getMessage()}");
        }
    }
}
