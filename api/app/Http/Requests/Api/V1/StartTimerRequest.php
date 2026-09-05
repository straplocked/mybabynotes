<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

class StartTimerRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'type' => ['required', 'in:nurse,pump,sleep,tummy'],
            'baby_id' => ['sometimes', 'nullable', 'integer'],
        ];
    }
}
