<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Services;

use App\Events\HouseholdTouched;
use App\Models\Entry;
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
     * Which entry types can be re-opened: only the span types (t stamps the END
     * of the session, its length in the detail) have a start to pick up from.
     */
    private const RESUMABLE = ['sleep'];

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
        return $this->begin($user, $type, $babyId, $id, null);
    }

    /**
     * Re-open a sleep that already ended. A baby who stirs for five minutes had
     * ONE nap with a gap in it, not two naps, so instead of logging a second
     * session the timer picks up where that entry STARTED and carries a
     * `resumes` pointer back to it — whoever stops it (either phone) rewrites
     * that one entry rather than stacking a row on top of it. Null when the id
     * isn't a live, resumable entry of ours: the caller says so out loud.
     *
     * @return array{id: string, type: string, started_at: int, user_id: int, baby_id: int|null, resumes: string}|null
     */
    public function resume(User $user, string $entryId, ?string $id = null): ?array
    {
        $entry = $user->household->entries()
            ->where('id', $entryId)
            ->where('deleted', false)
            ->whereIn('type', self::RESUMABLE)
            ->first();
        if (! $entry) {
            return null;
        }

        // the session keeps its own child — the resuming phone's pill switch
        // must not re-home the nap any more than a mid-session switch does
        return $this->begin($user, $entry->type, $entry->baby_id, $id, $entry);
    }

    /**
     * @return array{id: string, type: string, started_at: int, user_id: int, baby_id: int|null}
     */
    private function begin(User $user, string $type, ?int $babyId, ?string $id, ?Entry $resume): array
    {
        $household = $user->household;
        // the timer's child must be one of ours — a foreign id is dropped, and
        // clients read a null baby_id as the primary child
        $validBabyId = $babyId !== null
            ? $household->children()->whereKey($babyId)->value('id')
            : null;
        $timers = $household->runningTimers();
        foreach ($timers as $t) {
            // double-tap guard. A resume matches on the entry it re-opens (two
            // phones tapping Resume on the same nap is one session); a plain
            // start matches the identical session you already have running.
            if (($t['id'] ?? null) === $id
                || ($resume !== null && ($t['resumes'] ?? null) === $resume->id)
                || ($resume === null && ($t['type'] ?? null) === $type && ($t['baby_id'] ?? null) === $validBabyId && ($t['user_id'] ?? null) === $user->id)) {
                return $t;
            }
        }
        $startedAt = now()->getTimestampMs();
        if ($resume !== null) {
            // the re-opened session restarts where it began: a span entry stamps
            // the END of the sleep and carries its length in the detail, so the
            // start is t − length. A future-stamped entry can't backdate past now.
            $startedAt = min($startedAt, (int) $resume->t - $this->detailMinutes($resume->detail) * 60000);
        }
        $timer = [
            'id' => $id ?? (string) Str::uuid(),
            'type' => $type,
            'started_at' => $startedAt,
            'user_id' => $user->id,
            'baby_id' => $validBabyId,
        ];
        if ($resume !== null) {
            $timer['resumes'] = $resume->id;
        }
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
        // the activity word ('nursing', 'a sleep timer') is its own catalog
        // key, nested so it lands translated inside the sentence. A resume says
        // so: "started a sleep timer" would read as a second nap beginning.
        $params = ['name' => $user->name, 'what' => [self::LABELS[$type]]];
        $title = match (true) {
            $resume !== null && $childName !== null => [':name resumed :what for :child', $params + ['child' => $childName]],
            $resume !== null => [':name resumed :what', $params],
            $childName !== null => [':name started :what for :child', $params + ['child' => $childName]],
            default => [':name started :what', $params],
        };

        // let the rest of the household know they're occupied — informational,
        // so it honors quiet hours (unlike a direct handoff ask)
        foreach ($household->othersFor($user) as $other) {
            if ($other->notifyPrefs()['timer'] && ! $other->inQuietHours()) {
                app(PushService::class)->notify(
                    $other,
                    'timer',
                    $title,
                    ['Timer running in mybabynotes.'],
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

    /**
     * A span entry's length, whichever way the wire spells it: a "45m" token
     * ("Nap · 45m") or the bare leading number the timer itself writes. Same
     * rule as the app's sleepMins(); anything else reads as zero.
     */
    private function detailMinutes(?string $detail): int
    {
        $detail = (string) $detail;
        if (preg_match('/(\d+)\s*m\b/', $detail, $m)) {
            return (int) $m[1];
        }

        return preg_match('/^\s*([\d.]+)/', $detail, $m) ? (int) round((float) $m[1]) : 0;
    }
}
