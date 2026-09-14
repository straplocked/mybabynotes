<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Shared is the resting state now: nobody is on duty unless somebody is
 * actually covering. Existing households can't get there on their own — duty
 * was seeded to the founding account at registration and every exit path
 * reassigned it to *someone*, so `on_duty_user_id` has never been null in a
 * live database and the new UI has no framing for the state they're sitting in.
 *
 * Two steps, in order:
 *
 * 1. Close stale `active` rows. A cover you started yourself had no self-serve
 *    end, so its row stayed `active` forever — harmless before (only the latest
 *    row was ever read) and load-bearing now, because step 2 treats an active
 *    row as "somebody really is covering" and would keep duty pinned to a shift
 *    that ended in real life weeks ago. 24h is well past any honest cover.
 *
 * 2. Null the duty holder for every household that isn't genuinely mid-cover.
 *    A household where someone IS covering right now keeps its holder — this
 *    migration resets a default, it doesn't interrupt anybody's afternoon.
 *
 * Old clients read null duty as "everyone is on duty" and offer their start
 * card, so a household whose phones haven't updated degrades, never breaks.
 */
return new class extends Migration
{
    private const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

    public function up(): void
    {
        $cutoff = (int) (microtime(true) * 1000) - self::STALE_AFTER_MS;
        $now = (int) (microtime(true) * 1000);

        DB::table('shifts')
            ->where('state', 'active')
            ->where(fn ($q) => $q->whereNull('started_at')->orWhere('started_at', '<', $cutoff))
            ->update(['state' => 'completed', 'ended_at' => $now, 'ended_by' => 'migration']);

        // `whereNotExists` rather than a join: a household keeps its holder only
        // when an active row names that same person
        DB::table('households')
            ->whereNotNull('on_duty_user_id')
            ->whereNotExists(fn ($q) => $q
                ->select(DB::raw(1))
                ->from('shifts')
                ->whereColumn('shifts.household_id', 'households.id')
                ->whereColumn('shifts.user_id', 'households.on_duty_user_id')
                ->where('shifts.state', 'active'))
            ->update(['on_duty_user_id' => null]);
    }

    public function down(): void
    {
        // No-op. Which account duty was seeded to is state, not data — there is
        // nothing to restore it from, and re-crowning an arbitrary member would
        // be worse than leaving the household shared.
    }
};
