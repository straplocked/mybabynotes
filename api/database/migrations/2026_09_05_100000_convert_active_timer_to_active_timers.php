<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// concurrent timers per household (twins nursing while a sleep timer runs):
// [{id, type, started_at, user_id, baby_id}, …] — the old single slot becomes
// a one-element list so any timer running through the deploy keeps running
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('households', function (Blueprint $table) {
            $table->json('active_timers')->nullable();
        });

        foreach (DB::table('households')->whereNotNull('active_timer')->get(['id', 'active_timer']) as $row) {
            $timer = json_decode($row->active_timer, true);
            if (is_array($timer)) {
                DB::table('households')->where('id', $row->id)
                    ->update(['active_timers' => json_encode([$timer])]);
            }
        }

        Schema::table('households', function (Blueprint $table) {
            $table->dropColumn('active_timer');
        });
    }

    public function down(): void
    {
        Schema::table('households', function (Blueprint $table) {
            $table->json('active_timer')->nullable();
        });

        foreach (DB::table('households')->whereNotNull('active_timers')->get(['id', 'active_timers']) as $row) {
            $timers = json_decode($row->active_timers, true);
            if (is_array($timers) && $timers) {
                DB::table('households')->where('id', $row->id)
                    ->update(['active_timer' => json_encode(end($timers))]);
            }
        }

        Schema::table('households', function (Blueprint $table) {
            $table->dropColumn('active_timers');
        });
    }
};
