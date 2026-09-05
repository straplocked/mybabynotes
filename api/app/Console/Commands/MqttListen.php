<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Console\Commands;

use App\Contracts\MqttConnection;
use App\Contracts\MqttConnectionFactory;
use App\Models\Household;
use App\Services\Mqtt\MqttCommandHandler;
use App\Services\Mqtt\MqttPublisher;
use App\Services\Mqtt\MqttTopology;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

/**
 * The long-lived MQTT side of the Home Assistant integration: subscribes to
 * command topics (HA button presses) and owns availability via a real Last
 * Will. Designed to run unconditionally in every deployment shape — with no
 * MQTT-enabled household it just idles and re-checks. The outer loop never
 * exits; a broker outage costs a retry every POLL seconds.
 */
class MqttListen extends Command
{
    protected $signature = 'mqtt:listen {--once : Run a single service cycle and exit (tests)}';

    protected $description = 'Subscribe to Home Assistant command topics and maintain MQTT availability';

    private const POLL_SECONDS = 30;

    private const RESYNC_SECONDS = 900; // heal broker restarts / lost retained state

    /** @var array<int, MqttConnection> household id => open connection */
    private array $connections = [];

    /** @var array<int, string> household id => config hash the connection used */
    private array $configHashes = [];

    /** @var array<int, int> household id => last full-resync unix time */
    private array $resyncAt = [];

    public function handle(MqttConnectionFactory $factory, MqttCommandHandler $handler, MqttPublisher $publisher): int
    {
        do {
            try {
                $this->serviceCycle($factory, $handler, $publisher);
            } catch (\Throwable $e) {
                $this->warn("mqtt:listen cycle failed: {$e->getMessage()}");
            }
            if (! $this->option('once')) {
                sleep(self::POLL_SECONDS);
            }
        } while (! $this->option('once'));

        return self::SUCCESS;
    }

    private function serviceCycle(MqttConnectionFactory $factory, MqttCommandHandler $handler, MqttPublisher $publisher): void
    {
        $enabled = Household::query()
            ->whereNotNull('mqtt_config')->get()
            ->filter(fn ($h) => (bool) ($h->mqtt_config['enabled'] ?? false));

        // drop connections for households that disabled MQTT or changed config
        foreach ($this->connections as $hid => $connection) {
            $household = $enabled->firstWhere('id', $hid);
            $hash = $household ? md5(json_encode($household->mqtt_config)) : null;
            if (! $household || $hash !== $this->configHashes[$hid]) {
                $connection->disconnect();
                unset($this->connections[$hid], $this->configHashes[$hid], $this->resyncAt[$hid]);
            }
        }

        foreach ($enabled as $household) {
            $hid = $household->id;
            $config = $household->mqtt_config;
            $topology = new MqttTopology($household, $config);

            if (! isset($this->connections[$hid])) {
                try {
                    $connection = $factory->make($config, "babylog-listen-{$hid}");
                    // the listener owns availability: a real LWT flips the
                    // household offline if this process dies
                    $connection->connect([
                        'topic' => $topology->availabilityTopic(),
                        'payload' => 'offline',
                    ]);
                    $connection->subscribe(
                        $topology->commandTopic(),
                        function (string $topic, string $payload) use ($hid, $handler) {
                            $fresh = Household::with(['users', 'children'])->find($hid);
                            if ($fresh) {
                                $handler->handle($fresh, $payload);
                            }
                        },
                    );
                    $connection->publish($topology->availabilityTopic(), 'online', true);
                    $this->connections[$hid] = $connection;
                    $this->configHashes[$hid] = md5(json_encode($config));
                    $this->resyncAt[$hid] = 0;
                    $this->info("Listening for household {$hid}");
                } catch (\Throwable $e) {
                    $this->warn("Broker unreachable for household {$hid}: {$e->getMessage()}");

                    continue;
                }
            }

            // periodic full resync heals a restarted broker's lost retained state
            if (time() - ($this->resyncAt[$hid] ?? 0) >= self::RESYNC_SECONDS) {
                $publisher->publishEverything($household->load(['users', 'children']));
                $this->resyncAt[$hid] = time();
            }

            try {
                $this->connections[$hid]->loopFor(2);
                Cache::put("mqtt:heartbeat:{$hid}", now()->toIso8601String(), 600);
                Cache::forget("mqtt:down:{$hid}");
            } catch (\Throwable $e) {
                $this->warn("Lost broker connection for household {$hid}: {$e->getMessage()}");
                $this->connections[$hid]->disconnect();
                unset($this->connections[$hid], $this->configHashes[$hid], $this->resyncAt[$hid]);
            }
        }
    }
}
