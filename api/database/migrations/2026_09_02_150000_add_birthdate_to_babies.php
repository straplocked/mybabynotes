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
        Schema::table('babies', function (Blueprint $table) {
            $table->date('birthdate')->nullable(); // real DOB; age_label stays as the pre-DOB fallback
        });
    }

    public function down(): void
    {
        Schema::table('babies', fn (Blueprint $table) => $table->dropColumn('birthdate'));
    }
};
