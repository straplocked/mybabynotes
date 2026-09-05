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
        Schema::create('households', function (Blueprint $table) {
            $table->id();
            $table->string('invite_email')->nullable()->index();
            $table->foreignId('on_duty_user_id')->nullable();
            $table->timestamps();
        });

        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('household_id')->nullable()->constrained()->after('id');
        });

        Schema::create('babies', function (Blueprint $table) {
            $table->id();
            $table->foreignId('household_id')->constrained();
            $table->string('name');
            $table->string('age_label')->nullable();
            $table->timestamps();
        });

        Schema::create('entries', function (Blueprint $table) {
            // client-generated ids so offline writes merge cleanly
            $table->string('id')->primary();
            $table->foreignId('household_id')->constrained();
            $table->foreignId('user_id');
            $table->string('type');
            $table->unsignedBigInteger('t');          // event time, ms epoch
            $table->string('detail')->nullable();
            $table->boolean('deleted')->default(false);
            $table->unsignedBigInteger('rev');        // server ms of last write, for since-pulls
            $table->timestamps();
            $table->index(['household_id', 'rev']);
        });

        Schema::create('shifts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('household_id')->constrained();
            $table->string('state');                  // requested | active | completed
            $table->foreignId('requester_id')->nullable();  // who asked to hand off
            $table->foreignId('user_id')->nullable(); // who is / was on duty
            $table->text('note')->nullable();         // handoff request note
            $table->json('plan')->nullable();         // [{id,type,at}]
            $table->string('until')->nullable();
            $table->unsignedBigInteger('requested_at')->nullable();
            $table->unsignedBigInteger('started_at')->nullable();
            $table->unsignedBigInteger('ended_at')->nullable();
            $table->text('handback_note')->nullable();
            $table->timestamps();
            $table->index(['household_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shifts');
        Schema::dropIfExists('entries');
        Schema::dropIfExists('babies');
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn('household_id'));
        Schema::dropIfExists('households');
    }
};
