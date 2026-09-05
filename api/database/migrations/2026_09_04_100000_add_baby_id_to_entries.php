<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('entries', function (Blueprint $table) {
            // nullable: old clients push entries without a baby; the server
            // defaults them to the primary child at write time
            $table->foreignId('baby_id')->nullable()->constrained('babies')->nullOnDelete();
        });

        // backfill: every existing entry belongs to the household's (only) baby.
        // Plain query-builder loop so it runs the same on a populated SQLite DB.
        $primaries = DB::table('babies')
            ->selectRaw('household_id, MIN(id) as baby_id')
            ->groupBy('household_id')
            ->get();
        foreach ($primaries as $row) {
            DB::table('entries')
                ->where('household_id', $row->household_id)
                ->whereNull('baby_id')
                ->update(['baby_id' => $row->baby_id]);
        }
    }

    public function down(): void
    {
        Schema::table('entries', fn (Blueprint $table) => $table->dropConstrainedForeignId('baby_id'));
    }
};
