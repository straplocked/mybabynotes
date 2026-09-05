<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Broker credentials live in their own encrypted column, NOT in
// households.settings — settings is returned verbatim by /state to every
// member (including caregivers) and synced into browser localStorage.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('households', function (Blueprint $table) {
            $table->text('mqtt_config')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('households', function (Blueprint $table) {
            $table->dropColumn('mqtt_config');
        });
    }
};
