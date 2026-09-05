<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Services\Mqtt;

use App\Contracts\MqttConnection;
use App\Contracts\MqttConnectionFactory;

class PhpMqttConnectionFactory implements MqttConnectionFactory
{
    public function make(array $config, string $clientId): MqttConnection
    {
        return new PhpMqttConnection($config, $clientId);
    }
}
