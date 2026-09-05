<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Shift extends Model
{
    protected $fillable = [
        'household_id', 'state', 'requester_id', 'user_id', 'note', 'plan', 'until',
        'until_at', 'until_notified_at', 'requested_at', 'started_at', 'ended_at', 'handback_note',
    ];

    protected $casts = [
        'plan' => 'array',
        'until_at' => 'integer',
        'until_notified_at' => 'integer',
        'requested_at' => 'integer',
        'started_at' => 'integer',
        'ended_at' => 'integer',
    ];

    public function household(): BelongsTo
    {
        return $this->belongsTo(Household::class);
    }
}
