<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Entry extends Model
{
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = ['id', 'household_id', 'user_id', 'baby_id', 'type', 't', 'detail', 'deleted', 'rev'];

    protected $casts = [
        't' => 'integer',
        'baby_id' => 'integer',
        'rev' => 'integer',
        'deleted' => 'boolean',
    ];
}
