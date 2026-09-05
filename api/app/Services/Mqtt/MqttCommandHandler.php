<?php

namespace App\Services\Mqtt;

use App\Models\Household;
use App\Models\User;
use App\Services\EntryWriter;
use App\Services\TimerService;
use Illuminate\Support\Facades\Log;

/**
 * Turns a button press in Home Assistant into a real write. Deliberately
 * narrow: logging and timers only — no auth, membership, or delete actions
 * ever ride this channel (anyone who can publish to the broker can press
 * these buttons; docs recommend a dedicated broker user with an ACL).
 */
class MqttCommandHandler
{
    public function handle(Household $household, string $payload): void
    {
        $cmd = json_decode($payload, true);
        if (! is_array($cmd) || ! isset($cmd['action'])) {
            return;
        }

        $config = $household->mqtt_config ?? [];
        $actor = $household->users()->find($config['acting_user_id'] ?? 0)
            ?? $household->users()->orderBy('id')->first();
        if (! $actor instanceof User) {
            return;
        }

        // a baby_id must be one of this household's children or the command
        // falls back to "no baby_id" semantics (primary child)
        $babyId = null;
        if (isset($cmd['baby_id'])) {
            $babyId = $household->children()->whereKey((int) $cmd['baby_id'])->value('id');
        }

        try {
            match ($cmd['action']) {
                'log' => $this->log($actor, $cmd, $babyId),
                'timer_start' => app(TimerService::class)->start(
                    $actor,
                    in_array($cmd['type'] ?? '', ['nurse', 'pump', 'sleep', 'tummy'], true) ? $cmd['type'] : 'sleep',
                    $babyId,
                ),
                // timer_id picks one of several running timers; without it the
                // stop takes the household's newest — the one the HA sensor shows
                'timer_stop' => app(TimerService::class)->stop(
                    $actor,
                    isset($cmd['timer_id'])
                        ? substr((string) $cmd['timer_id'], 0, 64)
                        : (array_reverse($household->runningTimers())[0]['id'] ?? null),
                ),
                default => null,
            };
        } catch (\Throwable $e) {
            Log::warning("MQTT command failed for household {$household->id}: {$e->getMessage()}");
        }
    }

    private function log(User $actor, array $cmd, ?int $babyId): void
    {
        $type = (string) ($cmd['type'] ?? '');
        if ($type === '' || strlen($type) > 20) {
            return;
        }
        $detail = isset($cmd['detail']) ? substr((string) $cmd['detail'], 0, 100) : null;

        // EntryWriter fires HouseholdTouched, which pokes the phones AND
        // republishes MQTT state — one write path for every producer
        app(EntryWriter::class)->create($actor, [
            'type' => $type,
            't' => now()->getTimestampMs(),
            'detail' => $detail,
            'baby_id' => $babyId,
        ]);
    }
}
