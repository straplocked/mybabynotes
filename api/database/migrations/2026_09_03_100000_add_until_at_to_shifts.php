<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('shifts', function (Blueprint $table) {
            // ms epoch the accepter's "until" label resolves to (client-computed,
            // in the accepter's own timezone); null for open-ended/wake-dependent
            $table->unsignedBigInteger('until_at')->nullable();
            // ms epoch the once-only "shift over" ping went out — the reminder
            // command runs every minute, so this marker is what keeps it to one
            $table->unsignedBigInteger('until_notified_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('shifts', function (Blueprint $table) {
            $table->dropColumn(['until_at', 'until_notified_at']);
        });
    }
};
