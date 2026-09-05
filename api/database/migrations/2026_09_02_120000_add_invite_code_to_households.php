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
        Schema::table('households', function (Blueprint $table) {
            $table->string('invite_code_hash')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('households', fn (Blueprint $table) => $table->dropColumn('invite_code_hash'));
    }
};
