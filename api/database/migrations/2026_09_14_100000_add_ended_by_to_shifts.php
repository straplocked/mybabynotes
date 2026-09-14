<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A cover now has three exits — you end it, its "until" ends it, or you hand it
 * to a named person — and the report reads differently for each. This records
 * which one happened: holder | parent | until | handback | assign | removed.
 *
 * Deliberately NOT a new `state` value. An `expired` state would fall through
 * every branch the client derives from the shift row, and `showReport` keys on
 * `state === 'completed'` — so an installed client would silently lose the
 * report for an auto-ended cover. Completing the row keeps every old client
 * working; `ended_by` is an additive key they ignore, exactly like `target_id`
 * and `until_at` before it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('shifts', function (Blueprint $table) {
            $table->string('ended_by')->nullable()->after('ended_at');
        });
    }

    public function down(): void
    {
        Schema::table('shifts', function (Blueprint $table) {
            $table->dropColumn('ended_by');
        });
    }
};
