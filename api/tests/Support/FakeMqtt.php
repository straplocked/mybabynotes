<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace Tests\Support;

use App\Contracts\MqttConnection;
use App\Contracts\MqttConnectionFactory;

/**
 * Socket-free MQTT double. The factory records every connection it makes;
 * each connection records publishes/subscriptions. Set $failConnect to make
 * the broker "unreachable".
 */
class FakeMqtt implements MqttConnectionFactory
{
    public bool $failConnect = false;

    /** @var FakeMqttConnection[] */
    public array $connections = [];

    public function make(array $config, string $clientId): MqttConnection
    {
        return $this->connections[] = new FakeMqttConnection($this, $config, $clientId);
    }

    /** Every publish across every connection: [topic, payload, retain]. */
    public function publishes(): array
    {
        return array_merge(...array_map(fn ($c) => $c->published, $this->connections) ?: [[]]);
    }

    public function payloadFor(string $topic): ?string
    {
        foreach (array_reverse($this->publishes()) as [$t, $payload]) {
            if ($t === $topic) {
                return $payload;
            }
        }

        return null;
    }
}

class FakeMqttConnection implements MqttConnection
{
    /** @var array<int, array{0: string, 1: string, 2: bool}> */
    public array $published = [];

    /** @var array<string, callable> */
    public array $subscriptions = [];

    public ?array $will = null;

    public bool $connected = false;

    public function __construct(private FakeMqtt $factory, public array $config, public string $clientId)
    {
    }

    public function connect(?array $will = null): void
    {
        if ($this->factory->failConnect) {
            throw new \RuntimeException('Connection refused');
        }
        $this->will = $will;
        $this->connected = true;
    }

    public function publish(string $topic, string $payload, bool $retain = false): void
    {
        $this->published[] = [$topic, $payload, $retain];
    }

    public function subscribe(string $topicFilter, callable $handler): void
    {
        $this->subscriptions[$topicFilter] = $handler;
    }

    public function deliver(string $topic, string $payload): void
    {
        foreach ($this->subscriptions as $filter => $handler) {
            if ($filter === $topic) {
                $handler($topic, $payload);
            }
        }
    }

    public function loopFor(int $seconds): void
    {
    }

    public function disconnect(): void
    {
        $this->connected = false;
    }
}
