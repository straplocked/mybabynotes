<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Controllers\Api;

use App\Contracts\MqttConnectionFactory;
use App\Contracts\MqttFailure;
use App\Exceptions\MqttConnectFailedException;
use App\Http\Controllers\Controller;
use App\Services\Mqtt\MqttPublisher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * The Home Assistant / MQTT integration settings. Parent-only: broker
 * credentials are household infrastructure. The password is write-only —
 * GET masks it to a hasPassword flag, POST with a blank password keeps the
 * stored one, and nothing here ever appears in /state or client storage.
 */
class MqttController extends Controller
{
    private const DEFAULTS = [
        'enabled' => false, 'host' => '', 'port' => 1883, 'username' => '',
        'password' => '', 'tls' => false, 'tls_verify' => true,
        'discovery_prefix' => 'homeassistant', 'base_topic' => 'babylog',
        'acting_user_id' => null,
    ];

    private function parentsOnly(Request $request): ?JsonResponse
    {
        return $request->user()->isParent()
            ? null
            : response()->json(['message' => __('Only a parent can change that.')], 403);
    }

    private function publicConfig(array $config): array
    {
        $public = array_intersect_key($config + self::DEFAULTS, self::DEFAULTS);
        $public['hasPassword'] = ($config['password'] ?? '') !== '';
        unset($public['password']);

        return $public;
    }

    public function show(Request $request): JsonResponse
    {
        if ($denied = $this->parentsOnly($request)) {
            return $denied;
        }

        $household = $request->user()->household;
        $config = $household->mqtt_config ?? [];
        $heartbeat = Cache::get("mqtt:heartbeat:{$household->id}");

        return response()->json([
            'config' => $this->publicConfig($config),
            'status' => ['heartbeatAt' => $heartbeat],
        ]);
    }

    public function save(Request $request, MqttPublisher $publisher): JsonResponse
    {
        if ($denied = $this->parentsOnly($request)) {
            return $denied;
        }

        $data = $this->validated($request);

        $household = $request->user()->household;
        $stored = $household->mqtt_config ?? [];
        $wasEnabled = (bool) ($stored['enabled'] ?? false);

        $config = $this->merge($request, $stored, $data);
        if ($config['enabled'] && $config['host'] === '') {
            return response()->json(['message' => __('A broker host is required to enable MQTT.')], 422);
        }
        $household->update(['mqtt_config' => $config]);

        // the publisher's 60s "enabled?" memo must not outlive a settings change
        Cache::forget("mqtt:enabled:{$household->id}");
        Cache::forget("mqtt:down:{$household->id}");

        if ($config['enabled']) {
            $publisher->publishEverything($household->fresh(['users', 'children']));
        } elseif ($wasEnabled) {
            $publisher->publishRemoval($household, $config);
        }

        return response()->json(['ok' => true, 'config' => $this->publicConfig($config)]);
    }

    /**
     * Try the submitted (or stored) credentials without persisting anything.
     *
     * The failure message is one of three fixed buckets — unreachable /
     * credentials refused / TLS failed. The driver's own text is logged, never
     * returned: it names hosts, ports, and OpenSSL internals, and echoing it
     * would turn this button into a reachability probe for whatever the API
     * container can see.
     */
    public function test(Request $request, MqttConnectionFactory $factory): JsonResponse
    {
        if ($denied = $this->parentsOnly($request)) {
            return $denied;
        }

        $data = $this->validated($request);
        $household = $request->user()->household;
        $config = $this->merge($request, $household->mqtt_config ?? [], $data);
        if ($config['host'] === '') {
            return response()->json(['ok' => false, 'message' => __('Enter a broker host first.')]);
        }

        try {
            $connection = $factory->make($config, 'babylog-test-'.$household->id);
            $connection->connect();
            $connection->publish(($config['base_topic'] ?? 'babylog')."/{$household->id}/test", 'ok');
            $connection->disconnect();
        } catch (\Throwable $e) {
            $reason = $e instanceof MqttConnectFailedException ? $e->reason : MqttFailure::Unreachable;
            Log::warning('mqtt test failed', [
                'household' => $household->id, 'reason' => $reason->value, 'error' => $e->getMessage(),
            ]);

            return response()->json(['ok' => false, 'message' => __(match ($reason) {
                MqttFailure::Credentials => 'The broker rejected the credentials.',
                MqttFailure::Tls => 'TLS handshake failed.',
                MqttFailure::Unreachable => 'Couldn’t reach the broker.',
            })]);
        }

        return response()->json(['ok' => true]);
    }

    private function validated(Request $request): array
    {
        return $request->validate([
            'enabled' => ['sometimes', 'boolean'],
            'host' => ['sometimes', 'string', 'max:255'],
            'port' => ['sometimes', 'integer', 'min:1', 'max:65535'],
            'username' => ['sometimes', 'nullable', 'string', 'max:100'],
            'password' => ['sometimes', 'nullable', 'string', 'max:255'],
            'tls' => ['sometimes', 'boolean'],
            'tls_verify' => ['sometimes', 'boolean'],
            'discovery_prefix' => ['sometimes', 'string', 'max:64'],
            'base_topic' => ['sometimes', 'string', 'max:64', 'regex:/^[A-Za-z0-9_-]+$/'],
            'acting_user_id' => ['sometimes', 'nullable', 'integer'],
        ]);
    }

    private function merge(Request $request, array $stored, array $data): array
    {
        $config = array_merge(self::DEFAULTS, $stored, $data);
        // blank/absent password keeps the stored one (write-only field)
        if (! isset($data['password']) || $data['password'] === '' || $data['password'] === null) {
            $config['password'] = $stored['password'] ?? '';
        }
        $config['username'] = (string) ($config['username'] ?? '');
        $config['host'] = trim((string) $config['host']);

        // who MQTT-originated entries are attributed to: a named member, else
        // the parent touching the settings
        $memberIds = $request->user()->household->users()->pluck('id')->all();
        if (! in_array($config['acting_user_id'], $memberIds, true)) {
            $config['acting_user_id'] = $request->user()->id;
        }

        return $config;
    }
}
