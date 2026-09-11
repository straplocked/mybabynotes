<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Exceptions;

use App\Contracts\MqttFailure;

/**
 * Thrown by MqttConnection::connect() when the broker can't be reached,
 * refuses the credentials, or fails the TLS handshake. Library-agnostic:
 * the adapter maps driver codes onto $reason; the message keeps the driver's
 * detail for the log only.
 */
class MqttConnectFailedException extends \RuntimeException
{
    public function __construct(
        public readonly MqttFailure $reason,
        string $message,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }
}
