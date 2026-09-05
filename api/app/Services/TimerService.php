<?php

namespace App\Services;

use App\Events\HouseholdTouched;
use App\Models\User;
use Illuminate\Support\Str;

/**
 * The one write path for the household's live timers, shared by the internal
 * endpoints, /api/v1, MCP tools, and the MQTT command handler. Only running
 * state lives on the household — stopping never writes an entry (the server
 * stores facts, not in-flight guesses); producers log the resulting entry
 * themselves via EntryWriter, exactly like the PWA does.
 */
class TimerService
{
    private const LABELS = ['nurse' => 'nursing', 'pump' => 'pumping', 'sleep' => 'a sleep timer', 'tummy' => 'tummy time'];

    /**
     * Start a timer acting as $user. Timers stack — a nursing timer for one
     * twin and a sleep timer for the other run side by side — but starting the
     * exact session you already have running (same type, child, and starter)
     * returns the existing timer instead of piling on a double-tap duplicate.
     * $id lets the PWA supply its client-generated id (entry-style), so its
     * optimistic row and the server copy are the same timer.
     *
     * @return array{id: string, type: string, started_at: int, user_id: int, baby_id: int|null}
     */
    public function start(User $user, string $type, ?int $babyId = null, ?string $id = null): array
    {
        $household = $user->household;
        // the timer's child must be one of ours — a foreign id is dropped, and
        // clients read a null baby_id as the primary child
        $validBabyId = $babyId !== null
            ? $household->children()->whereKey($babyId)->value('id')
            : null;
        $timers = $household->runningTimers();
        foreach ($timers as $t) {
            if (($t['id'] ?? null) === $id
                || (($t['type'] ?? null) === $type && ($t['baby_id'] ?? null) === $validBabyId && ($t['user_id'] ?? null) === $user->id)) {
                return $t;
            }
        }
        $timer = [
            'id' => $id ?? (string) Str::uuid(),
            'type' => $type,
            'started_at' => now()->getTimestampMs(),
            'user_id' => $user->id,
            'baby_id' => $validBabyId,
        ];
        $timers[] = $timer;
        $household->update(['active_timers' => $timers]);

        HouseholdTouched::send($household->id, 'timer');

        // with 2+ unarchived children the push names the timer's child (a null
        // baby_id reads as the primary, same rule clients use) — the partner's
        // lock screen shouldn't have to guess which twin is nursing
        $childName = null;
        if ($household->children()->where('archived', false)->count() > 1) {
            $childName = $validBabyId !== null
                ? $household->children()->whereKey($validBabyId)->value('name')
                : $household->children()->value('name'); // children() is id-ordered, so first = primary
        }
        $title = $user->name.' started '.self::LABELS[$type].($childName ? ' for '.$childName : '');

        // let the rest of the household know they're occupied — informational,
        // so it honors quiet hours (unlike a direct handoff ask)
        foreach ($household->othersFor($user) as $other) {
            if ($other->notifyPrefs()['timer'] && ! $other->inQuietHours()) {
                app(PushService::class)->notify(
                    $other,
                    'timer',
                    $title,
                    'Timer running in mybabynotes.',
                );
            }
        }

        return $timer;
    }

    /**
     * Stop one timer, returning what was running (null if nothing matched).
     * Without an id (pre-multi-timer clients, the HA stop button) this stops
     * the caller's newest timer, else the household's newest — the same timer
     * those clients were shown in the legacy singular slot.
     *
     * @return array{id: string, type: string, started_at: int, user_id: int, baby_id: int|null}|null
     */
    public function stop(User $user, ?string $timerId = null): ?array
    {
        $household = $user->household;
        $timers = $household->runningTimers();
        if ($timerId === null) {
            $timerId = $household->legacyTimerFor($user)['id'] ?? null;
        }
        $stopped = null;
        $remaining = [];
        foreach ($timers as $t) {
            if ($stopped === null && ($t['id'] ?? null) === $timerId) {
                $stopped = $t;
            } else {
                $remaining[] = $t;
            }
        }
        if ($stopped === null) {
            return null; // already gone (a race with the other phone) — nothing to announce
        }
        $household->update(['active_timers' => $remaining ?: null]);

        HouseholdTouched::send($household->id, 'timer');

        return $stopped;
    }
}
