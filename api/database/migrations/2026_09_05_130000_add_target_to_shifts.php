<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A handoff ask can name who it's for. Null keeps today's behavior — the ask
 * fans out to the whole household and whoever's free answers it — which stays
 * the default for two-adult homes. Naming someone matters once there are three:
 * you ask the night carer, not your partner.
 *
 * The ask's plan/until ride on columns the table already has (they were only
 * ever written on `active` rows before), so this is the whole schema cost of
 * moving plan authorship to the person handing off.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('shifts', function (Blueprint $table) {
            $table->foreignId('target_id')->nullable()->after('requester_id');
        });
    }

    public function down(): void
    {
        Schema::table('shifts', function (Blueprint $table) {
            $table->dropColumn('target_id');
        });
    }
};
