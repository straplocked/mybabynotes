<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Console\Commands;

use App\Models\Household;
use App\Models\Shift;
use App\Models\User;
use App\Services\PushService;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Runs every minute via the scheduler. Each reminder kind fires at most once
 * per triggering event (per feed, per nap, per day) — the dedupe lives in
 * users.notify_state, so a restart can't double-ping anyone.
 */
class SendReminders extends Command
{
    protected $signature = 'babylog:reminders';

    protected $description = 'Send due push reminders (feed gap, wake window, daily meds)';

    /** Feeds closer together than this are one cluster session, not a new rhythm beat. */
    private const CLUSTER_GAP_MS = 45 * 60000;

    /** Age-typical max wake window in minutes — [max age in weeks, minutes], from docs/feeding-patterns.md. */
    private const MAX_WAKE_MINS = [
        [4, 90], [13, 90], [17, 120], [22, 150], [30, 180],
        [43, 210], [61, 240], [104, 360], [999, 360],
    ];

    public function handle(PushService $push): void
    {
        $this->untilReminder($push);

        $users = User::whereHas('pushSubscriptions')->with(['household.children'])->get();
        foreach ($users as $user) {
            if (! $user->household) {
                continue;
            }
            $p = $user->notifyPrefs();
            if (! ($p['feed'] || $p['wake'] || $p['meds']) || $user->inQuietHours()) {
                continue;
            }
            $state = $user->notify_state ?? [];
            $dirty = $this->feedReminder($push, $user, $p, $state);
            $dirty = $this->wakeReminder($push, $user, $p, $state) || $dirty;
            $dirty = $this->medsReminder($push, $user, $p, $state) || $dirty;
            if ($dirty) {
                $user->update(['notify_state' => $state]);
            }
        }
    }

    /**
     * An active shift's clock-time "until" has passed: ping the shift-holder
     * ("hand back?") and their counterpart — the member who asked for the
     * cover (a self-started shift falls back to the first other member) —
     * once, and change nothing: duty only ever moves through an explicit
     * handback. The rest of the household isn't part of this exchange and
     * stays unpinged. The marker lives on the shift row (until_notified_at),
     * so the every-minute schedule can't re-fire it; it is stamped before
     * pushing so a transport hiccup degrades to a missed ping, never a
     * nightly spam loop.
     */
    private function untilReminder(PushService $push): void
    {
        $now = now()->getTimestampMs();
        $due = Shift::where('state', 'active')
            ->whereNotNull('until_at')
            ->where('until_at', '<=', $now)
            ->whereNull('until_notified_at')
            ->with(['household.users', 'household.children'])
            ->get();
        foreach ($due as $shift) {
            $shift->update(['until_notified_at' => $now]);
            $household = $shift->household;
            $holder = $household?->users->firstWhere('id', $shift->user_id);
            if (! $holder) {
                continue;
            }
            $requester = $shift->requester_id ? $household->users->firstWhere('id', $shift->requester_id) : null;
            $counterpart = ($requester && $requester->id !== $holder->id ? $requester : null)
                ?? $household->partnerOf($holder);
            // name is data; the until label and "the baby" fallback are catalog
            // keys, nested so each recipient device reads them in its language
            $baby = $household->children->first()?->name ?? ['the baby'];
            $said = [$shift->until ? lcfirst($shift->until) : 'until about now'];
            if ($holder->notifyPrefs()['handoff'] && ! $holder->inQuietHours()) {
                $push->notify(
                    $holder,
                    'shift',
                    ['Shift over — hand back?'],
                    ['You said :said — nothing changes until you hand :baby back.', ['said' => $said, 'baby' => $baby]],
                );
            }
            if ($counterpart && $counterpart->notifyPrefs()['handoff'] && ! $counterpart->inQuietHours()) {
                $push->notify(
                    $counterpart,
                    'shift',
                    [':name’s shift is up', ['name' => $holder->name]],
                    ['They said :said — ready to take :baby back?', ['said' => $said, 'baby' => $baby]],
                );
            }
        }
    }

    private function feedReminder(PushService $push, User $user, array $p, array &$state): bool
    {
        if (! $p['feed']) {
            return false;
        }
        $hh = $user->household;
        if ($p['onDutyOnly'] && $hh->on_duty_user_id && $hh->on_duty_user_id !== $user->id) {
            return false;
        }
        $now = now()->getTimestampMs();
        $primaryId = $hh->children->first()?->id;
        $dirty = false;
        // every child keeps its own feed rhythm — twins don't share a stomach
        foreach ($hh->children->where('archived', false) as $child) {
            $ts = $this->childEntries($hh, $child->id, $primaryId)
                ->whereIn('type', ['bottle', 'nurse'])->where('deleted', false)
                ->where('t', '>', $now - 48 * 3600000)->where('t', '<=', $now)
                ->orderBy('t')->pluck('t')->all();
            if (! $ts) {
                continue;
            }
            $starts = $this->sessionStarts($ts);
            $lastStart = end($starts);
            // per-child override wins; a child without one inherits the global
            // interval (or the learned rhythm) exactly as before
            $every = ((array) ($p['feedEveryByChild'] ?? []))[$child->id] ?? $p['feedEvery'];
            $gap = $every ? $every * 60000 : $this->rhythmGap($starts);
            if ($now < $lastStart + $gap) {
                continue;
            }
            if ($now - $lastStart > 12 * 3600000) {
                continue; // log has gone quiet — a reminder now would just be noise
            }
            // per-child marker (the bare pre-multi-child key covers the primary
            // child across the upgrade, so nobody gets re-nudged mid-feed)
            $key = 'feedFor_'.$child->id;
            $already = ($state[$key] ?? null) === $lastStart
                || ($child->id === $primaryId && ($state['feedFor'] ?? null) === $lastStart);
            if ($already) {
                continue;
            }
            $state[$key] = $lastStart;
            $push->notify(
                $user,
                'feed',
                [':name is probably getting hungry', ['name' => $child->name ?? ['The baby']]],
                ['Last fed :ago ago — usually every ~:gap.', ['ago' => $this->dur($now - end($ts)), 'gap' => $this->dur($gap)]],
            );
            $dirty = true;
        }

        return $dirty;
    }

    private function wakeReminder(PushService $push, User $user, array $p, array &$state): bool
    {
        if (! $p['wake']) {
            return false;
        }
        $hh = $user->household;
        if (($hh->settings['tracking']['sleep'] ?? true) === false) {
            return false;
        }
        $now = now()->getTimestampMs();
        $primaryId = $hh->children->first()?->id;
        $dirty = false;
        foreach ($hh->children->where('archived', false) as $child) {
            if (! $child->birthdate) {
                continue; // the window is age-typical — no birthdate, no window
            }
            // sleep entries are stamped at the nap's end, so t is when the wake window opened
            $last = $this->childEntries($hh, $child->id, $primaryId)
                ->where('type', 'sleep')->where('deleted', false)
                ->where('t', '<=', $now)->orderByDesc('t')->first();
            if (! $last) {
                continue;
            }
            $awake = $now - $last->t;
            $weeks = (int) floor(max(0, $now - strtotime($child->birthdate.'T00:00:00') * 1000) / (7 * 86400000));
            $maxWake = $this->maxWakeMins($weeks) * 60000;
            // past 8h it's overnight or unlogged sleep, not a stretched wake window
            if ($awake < $maxWake || $awake > 8 * 3600000) {
                continue;
            }
            $key = 'wakeFor_'.$child->id;
            $already = ($state[$key] ?? null) === $last->t
                || ($child->id === $primaryId && ($state['wakeFor'] ?? null) === $last->t);
            if ($already) {
                continue;
            }
            $state[$key] = $last->t;
            $push->notify(
                $user,
                'wake',
                [':name has been awake a while', ['name' => $child->name ?? ['The baby']]],
                ['About :awake since the last logged nap — typical max for their age is :max.', ['awake' => $this->dur($awake), 'max' => $this->dur($maxWake)]],
            );
            $dirty = true;
        }

        return $dirty;
    }

    private function medsReminder(PushService $push, User $user, array $p, array &$state): bool
    {
        if (! $p['meds']) {
            return false;
        }
        $hh = $user->household;
        if (($hh->settings['tracking']['meds'] ?? true) === false) {
            return false;
        }
        try {
            $local = now($p['tz'] ?: config('app.timezone'));
        } catch (\Throwable) {
            $local = now();
        }
        if ($local->format('H:i') < $p['medsTime']) {
            return false;
        }
        $today = $local->toDateString();
        if (($state['medsDay'] ?? null) === $today) {
            return false;
        }
        // one decision per day, push or not — logged meds settle it quietly
        $state['medsDay'] = $today;
        $given = $hh->entries()->where('type', 'meds')->where('deleted', false)
            ->where('t', '>=', $local->copy()->startOfDay()->getTimestampMs())->exists();
        if (! $given) {
            $push->notify($user, 'meds', ['Meds time'], ['Nothing logged for :name yet today.', ['name' => $hh->children->first()?->name ?? ['the baby']]]);
        }

        return true;
    }

    /** Entries for one child; pre-multi-child rows (NULL baby_id) belong to the primary child. */
    private function childEntries(Household $hh, int $childId, ?int $primaryId): HasMany
    {
        return $hh->entries()->where(function ($q) use ($childId, $primaryId) {
            $q->where('baby_id', $childId);
            if ($childId === $primaryId) {
                $q->orWhereNull('baby_id');
            }
        });
    }

    /** First feed of each session, mirroring the client's cluster-feed folding. */
    private function sessionStarts(array $ts): array
    {
        $out = [];
        foreach ($ts as $i => $t) {
            if ($i === 0 || $t - $ts[$i - 1] > self::CLUSTER_GAP_MS) {
                $out[] = $t;
            }
        }

        return $out;
    }

    /** Learned gap between feed sessions, clamped so odd data can't spam or go silent. */
    private function rhythmGap(array $starts): int
    {
        $starts = array_slice($starts, -14);
        $gaps = [];
        for ($i = 1; $i < count($starts); $i++) {
            $gaps[] = $starts[$i] - $starts[$i - 1];
        }
        $avg = $gaps ? array_sum($gaps) / count($gaps) : 3 * 3600000;

        return (int) max(90 * 60000, min(6 * 3600000, $avg));
    }

    private function maxWakeMins(int $weeks): int
    {
        foreach (self::MAX_WAKE_MINS as [$max, $mins]) {
            if ($weeks < $max) {
                return $mins;
            }
        }

        return 360;
    }

    private function dur(int $ms): string
    {
        $m = (int) round($ms / 60000);
        if ($m < 60) {
            return $m.'m';
        }
        $h = intdiv($m, 60);

        return $h.'h'.($m % 60 ? ' '.($m % 60).'m' : '');
    }
}
