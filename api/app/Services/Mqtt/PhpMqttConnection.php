<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Services\Mqtt;

use App\Contracts\MqttConnection;
use PhpMqtt\Client\ConnectionSettings;
use PhpMqtt\Client\MqttClient;

/**
 * Real broker connection via php-mqtt/client. Timeouts are short on purpose:
 * publishes run inline on the request path (QUEUE_CONNECTION=sync), so a dead
 * broker must cost ~2s once and then trip the publisher's circuit breaker.
 */
class PhpMqttConnection implements MqttConnection
{
    private MqttClient $client;

    public function __construct(private array $config, string $clientId)
    {
        $this->client = new MqttClient(
            $config['host'],
            (int) ($config['port'] ?? 1883),
            $clientId,
            MqttClient::MQTT_3_1_1,
        );
    }

    public function connect(?array $will = null): void
    {
        $settings = (new ConnectionSettings)
            ->setConnectTimeout(2)
            ->setSocketTimeout(2)
            ->setKeepAliveInterval(60)
            ->setUsername($this->config['username'] ?: null)
            ->setPassword($this->config['password'] ?: null)
            ->setUseTls((bool) ($this->config['tls'] ?? false))
            ->setTlsVerifyPeer((bool) ($this->config['tls_verify'] ?? true));

        if ($will) {
            $settings = $settings
                ->setLastWillTopic($will['topic'])
                ->setLastWillMessage($will['payload'])
                ->setRetainLastWill(true);
        }

        $this->client->connect($settings, true);
    }

    public function publish(string $topic, string $payload, bool $retain = false): void
    {
        $this->client->publish($topic, $payload, MqttClient::QOS_AT_MOST_ONCE, $retain);
    }

    public function subscribe(string $topicFilter, callable $handler): void
    {
        $this->client->subscribe($topicFilter, fn ($topic, $message) => $handler($topic, $message));
    }

    public function loopFor(int $seconds): void
    {
        $this->client->loop(true, true, $seconds);
    }

    public function disconnect(): void
    {
        try {
            $this->client->disconnect();
        } catch (\Throwable) {
            // a half-dead socket on teardown is not our problem
        }
    }
}
