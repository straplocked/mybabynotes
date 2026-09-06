<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Server-side i18n: push copy is composed per SUBSCRIPTION (language is a
 * per-device preference, like the timezone already stored here), while
 * users.lang is "the language this account was last seen using" — the best
 * available guess for surfaces with no device attached (emails).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('push_subscriptions', function (Blueprint $table) {
            $table->string('lang', 8)->nullable()->after('timezone');
        });
        Schema::table('users', function (Blueprint $table) {
            $table->string('lang', 8)->nullable()->after('notify_state');
        });
    }

    public function down(): void
    {
        Schema::table('push_subscriptions', fn (Blueprint $table) => $table->dropColumn('lang'));
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn('lang'));
    }
};
