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
        Schema::create('invites', function (Blueprint $table) {
            $table->id();
            $table->foreignId('household_id')->constrained()->cascadeOnDelete();
            $table->string('email')->index();          // lowercased by code
            $table->string('code_hash');               // sha256 of the single-use 6-char code
            $table->string('role')->default('parent'); // role stamped onto the user at sign-up
            $table->foreignId('invited_by')->nullable();
            $table->timestamps();
        });

        // carry any pending single-invite over from the old household columns
        $now = now();
        $pending = DB::table('households')
            ->whereNotNull('invite_email')
            ->whereNotNull('invite_code_hash')
            ->get(['id', 'invite_email', 'invite_code_hash']);
        foreach ($pending as $h) {
            DB::table('invites')->insert([
                'household_id' => $h->id,
                'email' => strtolower($h->invite_email),
                'code_hash' => $h->invite_code_hash,
                'role' => 'parent',
                'invited_by' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        Schema::table('households', function (Blueprint $table) {
            $table->dropIndex(['invite_email']); // SQLite can't drop an indexed column
            $table->dropColumn(['invite_email', 'invite_code_hash']);
        });
    }

    public function down(): void
    {
        Schema::table('households', function (Blueprint $table) {
            $table->string('invite_email')->nullable()->index();
            $table->string('invite_code_hash')->nullable();
        });

        $pending = DB::table('invites')->orderBy('id')->get();
        foreach ($pending as $invite) {
            DB::table('households')->where('id', $invite->household_id)->update([
                'invite_email' => $invite->email,
                'invite_code_hash' => $invite->code_hash,
            ]);
        }

        Schema::dropIfExists('invites');
    }
};
