<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Contracts;

use App\Exceptions\MqttConnectFailedException;

/**
 * Thin seam over the MQTT client so tests never open sockets. One instance =
 * one broker connection; publishers connect/publish/disconnect, the listener
 * holds its connection open (with a Last Will) and loops.
 */
interface MqttConnection
{
    /**
     * @param  array{topic: string, payload: string}|null  $will retained LWT
     *
     * @throws MqttConnectFailedException with the failure sorted into a reason bucket
     */
    public function connect(?array $will = null): void;

    public function publish(string $topic, string $payload, bool $retain = false): void;

    /** @param  callable(string $topic, string $payload): void  $handler */
    public function subscribe(string $topicFilter, callable $handler): void;

    /** Process incoming messages for up to $seconds, then return. */
    public function loopFor(int $seconds): void;

    public function disconnect(): void;
}
