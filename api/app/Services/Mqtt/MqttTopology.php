<?php

namespace App\Services\Mqtt;

use App\Models\Household;
use Illuminate\Support\Carbon;

/**
 * Pure builder for everything MyBabyNotes says over MQTT: Home Assistant
 * device-based discovery payloads and retained state topics. No sockets here —
 * the publisher and the listener both feed these message lists to a
 * connection. Entity map: one HA device per unarchived child (via_device →
 * the household hub device) with last-activity timestamp sensors and
 * quick-log/timer buttons, plus a household device for on-duty, the single
 * running timer, and pumping (which tracks the parent, not a child).
 */
class MqttTopology
{
    private const FEEDS = ['bottle', 'nurse'];

    private const DIAPERS = ['wet', 'dirty', 'both'];

    public function __construct(private Household $household, private array $config)
    {
    }

    private function base(): string
    {
        return ($this->config['base_topic'] ?? 'babylog').'/'.$this->household->id;
    }

    private function discoveryPrefix(): string
    {
        return $this->config['discovery_prefix'] ?? 'homeassistant';
    }

    public function availabilityTopic(): string
    {
        return $this->base().'/availability';
    }

    public function commandTopic(): string
    {
        return $this->base().'/cmd';
    }

    /** @return array<int, array{topic: string, payload: string, retain: bool}> */
    public function discoveryMessages(): array
    {
        $hid = $this->household->id;
        $messages = [];

        $origin = ['name' => 'MyBabyNotes', 'url' => 'https://github.com/straplocked/mybabynotes'];
        $hub = "babylog_h{$hid}";

        $householdComponents = [
            'on_duty' => $this->sensor("{$hub}_on_duty", 'On duty', $this->base().'/on_duty', icon: 'mdi:account-heart'),
            'timer' => $this->sensor("{$hub}_timer", 'Active timer', $this->base().'/timer', icon: 'mdi:timer-outline',
                attrTopic: $this->base().'/timer/attr'),
            'timer_started' => $this->sensor("{$hub}_timer_started", 'Timer started', $this->base().'/timer_started',
                deviceClass: 'timestamp', icon: 'mdi:timer-play-outline'),
            'last_pump' => $this->sensor("{$hub}_last_pump", 'Last pump', $this->base().'/pump',
                deviceClass: 'timestamp', icon: 'mdi:mother-nurse', attrTopic: $this->base().'/pump/attr'),
            'btn_timer_stop' => $this->button("{$hub}_btn_timer_stop", 'Stop timer',
                ['action' => 'timer_stop'], 'mdi:timer-off-outline'),
            'btn_pump_start' => $this->button("{$hub}_btn_pump_start", 'Start pump timer',
                ['action' => 'timer_start', 'type' => 'pump'], 'mdi:timer-play-outline'),
        ];

        $messages[] = [
            'topic' => $this->discoveryPrefix()."/device/{$hub}/config",
            'payload' => json_encode([
                'dev' => ['ids' => [$hub], 'name' => 'MyBabyNotes', 'mf' => 'MyBabyNotes', 'mdl' => 'Household'],
                'o' => $origin,
                'avty_t' => $this->availabilityTopic(),
                'qos' => 0,
                'cmps' => $householdComponents,
            ], JSON_UNESCAPED_SLASHES),
            'retain' => true,
        ];

        $tracking = ($this->household->settings ?? [])['tracking'] ?? [];
        $tracks = fn (string $key) => (bool) ($tracking[$key] ?? true);

        foreach ($this->household->children as $child) {
            $dev = "babylog_h{$hid}_c{$child->id}";
            $topic = $this->discoveryPrefix()."/device/{$dev}/config";

            if ($child->archived) {
                // retained empty payload deletes the device from HA
                $messages[] = ['topic' => $topic, 'payload' => '', 'retain' => true];

                continue;
            }

            $c = $this->base().'/c/'.$child->id;
            $components = [
                'last_feeding' => $this->sensor("{$dev}_last_feeding", 'Last feeding', "{$c}/feeding",
                    deviceClass: 'timestamp', icon: 'mdi:baby-bottle-outline', attrTopic: "{$c}/feeding/attr"),
                'last_diaper' => $this->sensor("{$dev}_last_diaper", 'Last diaper', "{$c}/diaper",
                    deviceClass: 'timestamp', icon: 'mdi:human-baby-changing-table', attrTopic: "{$c}/diaper/attr"),
                'btn_log_wet' => $this->button("{$dev}_btn_log_wet", 'Log wet diaper',
                    ['action' => 'log', 'type' => 'wet', 'baby_id' => $child->id], 'mdi:water'),
                'btn_log_dirty' => $this->button("{$dev}_btn_log_dirty", 'Log dirty diaper',
                    ['action' => 'log', 'type' => 'dirty', 'baby_id' => $child->id], 'mdi:emoticon-poop'),
                'btn_nurse_start' => $this->button("{$dev}_btn_nurse_start", 'Start nurse timer',
                    ['action' => 'timer_start', 'type' => 'nurse', 'baby_id' => $child->id], 'mdi:timer-play'),
            ];
            if ($tracks('sleep')) {
                $components['last_sleep'] = $this->sensor("{$dev}_last_sleep", 'Last sleep', "{$c}/sleep",
                    deviceClass: 'timestamp', icon: 'mdi:sleep', attrTopic: "{$c}/sleep/attr");
                $components['btn_sleep_start'] = $this->button("{$dev}_btn_sleep_start", 'Start sleep timer',
                    ['action' => 'timer_start', 'type' => 'sleep', 'baby_id' => $child->id], 'mdi:sleep');
            }
            if ($tracks('tummy')) {
                $components['last_tummy'] = $this->sensor("{$dev}_last_tummy", 'Last tummy time', "{$c}/tummy",
                    deviceClass: 'timestamp', icon: 'mdi:baby-face-outline', attrTopic: "{$c}/tummy/attr");
                $components['btn_tummy_start'] = $this->button("{$dev}_btn_tummy_start", 'Start tummy time timer',
                    ['action' => 'timer_start', 'type' => 'tummy', 'baby_id' => $child->id], 'mdi:baby-face-outline');
            }
            if ($tracks('bath')) {
                $components['last_bath'] = $this->sensor("{$dev}_last_bath", 'Last bath', "{$c}/bath",
                    deviceClass: 'timestamp', icon: 'mdi:bathtub-outline', attrTopic: "{$c}/bath/attr");
            }
            if ($tracks('meds')) {
                $components['last_meds'] = $this->sensor("{$dev}_last_meds", 'Last meds', "{$c}/meds",
                    deviceClass: 'timestamp', icon: 'mdi:pill', attrTopic: "{$c}/meds/attr");
            }

            $messages[] = [
                'topic' => $topic,
                'payload' => json_encode([
                    'dev' => ['ids' => [$dev], 'name' => "{$child->name} (MyBabyNotes)",
                        'mf' => 'MyBabyNotes', 'mdl' => 'Child', 'via_device' => $hub],
                    'o' => $origin,
                    'avty_t' => $this->availabilityTopic(),
                    'qos' => 0,
                    'cmps' => $components,
                ], JSON_UNESCAPED_SLASHES),
                'retain' => true,
            ];
        }

        return $messages;
    }

    /** Retained empties that remove every HA device + clear availability. */
    public function removalMessages(): array
    {
        $hid = $this->household->id;
        $messages = [[
            'topic' => $this->discoveryPrefix()."/device/babylog_h{$hid}/config",
            'payload' => '', 'retain' => true,
        ]];
        foreach ($this->household->children as $child) {
            $messages[] = [
                'topic' => $this->discoveryPrefix()."/device/babylog_h{$hid}_c{$child->id}/config",
                'payload' => '', 'retain' => true,
            ];
        }
        $messages[] = ['topic' => $this->availabilityTopic(), 'payload' => 'offline', 'retain' => true];

        return $messages;
    }

    /** @return array<int, array{topic: string, payload: string, retain: bool}> */
    public function entryStateMessages(): array
    {
        $messages = [];
        $names = $this->memberNames();
        $primaryId = $this->household->children->first()?->id;

        foreach ($this->household->children->where('archived', false) as $child) {
            $c = $this->base().'/c/'.$child->id;
            $categories = [
                'feeding' => self::FEEDS,
                'diaper' => self::DIAPERS,
                'sleep' => ['sleep'],
                'tummy' => ['tummy'],
                'bath' => ['bath'],
                'meds' => ['meds'],
            ];
            foreach ($categories as $slug => $types) {
                $latest = $this->latestEntry($types, $child->id, $primaryId);
                $messages[] = [
                    'topic' => "{$c}/{$slug}",
                    'payload' => $latest ? Carbon::createFromTimestampMs($latest->t, 'UTC')->toIso8601String() : 'None',
                    'retain' => true,
                ];
                $messages[] = [
                    'topic' => "{$c}/{$slug}/attr",
                    'payload' => json_encode($latest ? [
                        'type' => $latest->type,
                        'detail' => $latest->detail,
                        'by' => $names[$latest->user_id] ?? null,
                    ] : new \stdClass, JSON_UNESCAPED_SLASHES),
                    'retain' => true,
                ];
            }
        }

        $pump = $this->latestEntry(['pump'], null, null);
        $messages[] = [
            'topic' => $this->base().'/pump',
            'payload' => $pump ? Carbon::createFromTimestampMs($pump->t, 'UTC')->toIso8601String() : 'None',
            'retain' => true,
        ];
        $messages[] = [
            'topic' => $this->base().'/pump/attr',
            'payload' => json_encode($pump ? [
                'detail' => $pump->detail, 'by' => $names[$pump->user_id] ?? null,
            ] : new \stdClass, JSON_UNESCAPED_SLASHES),
            'retain' => true,
        ];

        return $messages;
    }

    public function timerStateMessages(): array
    {
        // several timers can run at once; the sensor keeps its old single-value
        // shape (the newest timer) so existing HA dashboards don't break, and
        // the full list rides the attributes for automations that want it all
        $timers = $this->household->runningTimers();
        $timer = $timers ? end($timers) : null;
        $names = $this->memberNames();

        return [
            [
                'topic' => $this->base().'/timer',
                'payload' => $timer['type'] ?? 'none',
                'retain' => true,
            ],
            [
                'topic' => $this->base().'/timer/attr',
                'payload' => json_encode($timer ? [
                    'baby_id' => $timer['baby_id'],
                    'by' => $names[$timer['user_id']] ?? null,
                    'count' => count($timers),
                    'timers' => array_map(fn ($t) => [
                        'id' => $t['id'], 'type' => $t['type'], 'baby_id' => $t['baby_id'],
                        'started' => Carbon::createFromTimestampMs($t['started_at'], 'UTC')->toIso8601String(),
                        'by' => $names[$t['user_id']] ?? null,
                    ], $timers),
                ] : new \stdClass, JSON_UNESCAPED_SLASHES),
                'retain' => true,
            ],
            [
                'topic' => $this->base().'/timer_started',
                'payload' => $timer ? Carbon::createFromTimestampMs($timer['started_at'], 'UTC')->toIso8601String() : 'None',
                'retain' => true,
            ],
        ];
    }

    public function onDutyStateMessages(): array
    {
        $onDuty = $this->household->users->firstWhere('id', $this->household->on_duty_user_id);

        return [
            ['topic' => $this->base().'/on_duty', 'payload' => $onDuty->name ?? 'nobody', 'retain' => true],
        ];
    }

    public function allStateMessages(): array
    {
        return array_merge($this->entryStateMessages(), $this->timerStateMessages(), $this->onDutyStateMessages());
    }

    private function latestEntry(array $types, ?int $babyId, ?int $primaryId): ?object
    {
        $query = $this->household->entries()
            ->where('deleted', false)->whereIn('type', $types)
            ->orderByDesc('t')->orderByDesc('id');
        if ($babyId !== null) {
            // null baby_id rows belong to the primary child
            $query->where(fn ($q) => $babyId === $primaryId
                ? $q->where('baby_id', $babyId)->orWhereNull('baby_id')
                : $q->where('baby_id', $babyId));
        }

        return $query->first(['type', 't', 'detail', 'user_id']);
    }

    private function memberNames(): array
    {
        $names = $this->household->users->pluck('name', 'id')->all();
        foreach ($this->household->former_members ?? [] as $m) {
            $names[(int) $m['id']] ??= (string) $m['name'];
        }

        return $names;
    }

    private function sensor(
        string $uniqueId,
        string $name,
        string $stateTopic,
        ?string $deviceClass = null,
        ?string $icon = null,
        ?string $attrTopic = null,
    ): array {
        return array_filter([
            'p' => 'sensor',
            'uniq_id' => $uniqueId,
            'name' => $name,
            'stat_t' => $stateTopic,
            'dev_cla' => $deviceClass,
            'icon' => $icon,
            'json_attr_t' => $attrTopic,
        ]);
    }

    private function button(string $uniqueId, string $name, array $pressPayload, string $icon): array
    {
        return [
            'p' => 'button',
            'uniq_id' => $uniqueId,
            'name' => $name,
            'cmd_t' => $this->commandTopic(),
            'payload_press' => json_encode($pressPayload),
            'icon' => $icon,
        ];
    }
}
