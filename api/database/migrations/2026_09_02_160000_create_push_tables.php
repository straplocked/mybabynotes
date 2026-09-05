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
        // one row per device that opted into Web Push; the endpoint is the device identity
        Schema::create('push_subscriptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('endpoint', 500)->unique();
            $table->string('p256dh');
            $table->string('auth');
            $table->string('timezone', 64)->nullable();
            $table->timestamps();
        });

        // instance-wide VAPID keypair, auto-generated on first use — living in the DB
        // keeps the appliance zero-config and the keys inside the one backup-able file
        Schema::create('vapid_keys', function (Blueprint $table) {
            $table->id();
            $table->text('public_key');
            $table->text('private_key');
            $table->timestamps();
        });

        Schema::table('users', function (Blueprint $table) {
            $table->json('notify_prefs')->nullable();  // per-parent notification choices
            $table->json('notify_state')->nullable();  // reminder dedupe/throttle bookkeeping, never synced
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['notify_prefs', 'notify_state']);
        });
        Schema::dropIfExists('vapid_keys');
        Schema::dropIfExists('push_subscriptions');
    }
};
