<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Lightweight "something changed" poke. Clients react by pulling /state,
 * so the sync path is identical whether the trigger was a socket or a poll.
 */
class HouseholdTouched implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(public int $householdId, public string $kind)
    {
    }

    /**
     * Broadcast best-effort: realtime is a nicety — a Reverb hiccup must never
     * fail the write that triggered it. The PendingBroadcast dispatches on
     * destruct, so it's unset inside the try to catch transport errors.
     */
    public static function send(int $householdId, string $kind, bool $toOthers = true): void
    {
        try {
            $pending = broadcast(new self($householdId, $kind));
            if ($toOthers) {
                $pending->toOthers();
            }
            unset($pending);
        } catch (\Throwable) {
            // socket server unreachable — clients converge on their fallback poll
        }

        // Home Assistant fan-out rides the same choke point every mutation
        // already goes through. (broadcast() bypasses event listeners, so this
        // can't be a listener.) Unlike the websocket poke, MQTT carries state —
        // different transport, different consumers; the poke-to-pull invariant
        // is about our own clients and stays intact. No-op in ~1 cache read
        // when MQTT isn't configured; never fails the write.
        try {
            app(\App\Services\Mqtt\MqttPublisher::class)->publishForHousehold($householdId, $kind);
        } catch (\Throwable) {
            // MQTT is a nicety — the publisher has its own guards, this is belt+braces
        }
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('household.'.$this->householdId);
    }

    public function broadcastWith(): array
    {
        return ['kind' => $this->kind];
    }
}
