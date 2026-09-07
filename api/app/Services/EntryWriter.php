<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Services;

use App\Events\HouseholdTouched;
use App\Models\Entry;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * The one write path for log entries. Every producer — the PWA outbox, the
 * public /api/v1 endpoints, MCP tools, the MQTT command handler — goes through
 * here so the sync invariants live in exactly one place: client ids win,
 * latest write wins, deletes are tombstones, a foreign baby_id is dropped
 * (default to the primary child on create, preserve on update), an author
 * outside the household is dropped the same way (default to the caller on
 * create, preserve on update), and every batch fires one HouseholdTouched
 * poke plus the partner activity ping.
 */
class EntryWriter
{
    public const TYPE_LABELS = [
        'bottle' => 'a bottle', 'nurse' => 'nursing', 'pump' => 'a pump',
        'wet' => 'a wet diaper', 'dirty' => 'a dirty diaper', 'both' => 'a diaper',
        'sleep' => 'sleep', 'tummy' => 'tummy time', 'bath' => 'a bath', 'meds' => 'meds',
    ];

    /**
     * Batch upsert acting as $user. Rows are validated shapes:
     * {id, type, t, detail?, deleted?, baby_id?, user_id?}.
     *
     * @param  array<int, array<string, mixed>>  $entries
     * @return string[] ids actually written (cross-household collisions skipped)
     */
    public function upsert(User $user, array $entries): array
    {
        $rev = now()->getTimestampMs();

        // which child ids this household may write against; first (oldest) is
        // the primary child old clients mean when they send no baby_id at all
        $childIds = $user->household->children()->pluck('id')->all();
        $primaryChildId = $childIds[0] ?? null;

        // Who a row may name as its author. A timer runs under whoever started
        // it but can be stopped by whoever is free — a nap outlives the handoff
        // that happens mid-nap — so the stopping client names the session's
        // owner rather than itself, and the nursing stays credited to the
        // person who did it. Constrained to this household: a foreign id is
        // dropped exactly like a foreign baby_id, never stored.
        $memberIds = $user->household->users()->pluck('id')->all();

        $written = [];
        foreach ($entries as $e) {
            $existing = Entry::where('id', $e['id'])->first();
            if ($existing && $existing->household_id !== $user->household_id) {
                continue; // id collision across households — ignore
            }
            // a baby_id from another household is dropped, never stored: the
            // write then behaves as if the field were absent (default on
            // create, preserve on update)
            $babyId = isset($e['baby_id']) && in_array((int) $e['baby_id'], $childIds, true)
                ? (int) $e['baby_id']
                : ($existing->baby_id ?? $primaryChildId);
            // create-only, same rule as baby_id: an edit never re-homes an
            // existing row's author, so editing someone else's entry leaves
            // their name on it
            $authorId = isset($e['user_id']) && in_array((int) $e['user_id'], $memberIds, true)
                ? (int) $e['user_id']
                : $user->id;
            Entry::updateOrCreate(
                ['id' => $e['id']],
                [
                    'household_id' => $user->household_id,
                    'user_id' => $existing->user_id ?? $authorId,
                    'baby_id' => $babyId,
                    'type' => $e['type'],
                    't' => $e['t'],
                    'detail' => isset($e['detail']) ? (string) $e['detail'] : null,
                    'deleted' => (bool) ($e['deleted'] ?? false),
                    'rev' => $rev++,
                ],
            );
            $written[] = $e['id'];
        }

        HouseholdTouched::send($user->household_id, 'entries');
        $this->pingOthers($user, $entries);

        return $written;
    }

    /** Create one entry, generating the id when the producer has none. */
    public function create(User $user, array $fields): Entry
    {
        $id = (string) ($fields['id'] ?? Str::uuid());
        $this->upsert($user, [array_merge($fields, ['id' => $id])]);

        return Entry::findOrFail($id);
    }

    /**
     * Patch an existing in-household entry: unspecified fields keep their
     * stored values (upsert() requires type/t, so merge before writing).
     * Returns null when the id isn't ours — producers say so out loud.
     */
    public function update(User $user, string $id, array $fields): ?Entry
    {
        $existing = $user->household->entries()->where('id', $id)->first();
        if (! $existing) {
            return null;
        }
        $this->upsert($user, [[
            'id' => $id,
            'type' => $fields['type'] ?? $existing->type,
            't' => $fields['t'] ?? $existing->t,
            'detail' => array_key_exists('detail', $fields) ? $fields['detail'] : $existing->detail,
            'deleted' => array_key_exists('deleted', $fields) ? $fields['deleted'] : $existing->deleted,
            'baby_id' => $fields['baby_id'] ?? null, // absent on update preserves stored value
        ]]);

        return $existing->refresh();
    }

    /** Tombstone an in-household entry (never a hard delete). Null if not ours. */
    public function tombstone(User $user, string $id): ?Entry
    {
        return $this->update($user, $id, ['deleted' => true]);
    }

    /**
     * "Katrina logged a bottle" — opt-in activity push to every other member,
     * throttled per recipient to one ping per 10 minutes so a backfill burst
     * doesn't rattle anyone's phone.
     */
    private function pingOthers(User $user, array $entries): void
    {
        $live = array_values(array_filter($entries, fn ($e) => empty($e['deleted'])));
        if (! $live) {
            return;
        }
        $first = $live[0];
        $label = self::TYPE_LABELS[$first['type']] ?? $first['type'];
        $nowMs = now()->getTimestampMs();

        foreach ($user->household->othersFor($user) as $other) {
            if (! $other->notifyPrefs()['partner'] || $other->inQuietHours()) {
                continue;
            }
            // the throttle marker lives in each recipient's own notify_state
            $state = $other->notify_state ?? [];
            if (($state['partnerPingAt'] ?? 0) > $nowMs - 10 * 60000) {
                continue;
            }
            $other->update(['notify_state' => array_merge($state, ['partnerPingAt' => $nowMs])]);

            $tz = $other->notifyPrefs()['tz'] ?: config('app.timezone');
            try {
                $at = Carbon::createFromTimestampMs($first['t'], $tz)->format('g:i A');
            } catch (\Throwable) {
                $at = Carbon::createFromTimestampMs($first['t'])->format('g:i A');
            }
            // detail + time are data; only the "+N more" tail and the type
            // label translate (the label nests so it lands in-language)
            $start = implode(' · ', array_filter([
                isset($first['detail']) && $first['detail'] !== '' ? (string) $first['detail'] : null,
                $at,
            ]));
            $body = count($live) > 1
                ? ($start === '' ? ['+:n more', ['n' => count($live) - 1]] : [':start · +:n more', ['start' => $start, 'n' => count($live) - 1]])
                : $start;
            app(PushService::class)->notify($other, 'partner', [':name logged :type', ['name' => $user->name, 'type' => [$label]]], $body);
        }
    }
}
