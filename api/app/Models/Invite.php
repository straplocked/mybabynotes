<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A pending seat at a household: email-bound, single-use hashed code, per-invite role. */
class Invite extends Model
{
    protected $fillable = ['household_id', 'email', 'code_hash', 'role', 'invited_by'];

    protected $hidden = ['code_hash'];

    public function household(): BelongsTo
    {
        return $this->belongsTo(Household::class);
    }
}
