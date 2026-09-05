<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

/** Patch one entry: unspecified fields keep their stored values. */
class UpdateEntryRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'type' => ['sometimes', 'string', 'max:20'],
            't' => ['sometimes', 'integer'],
            'detail' => ['sometimes', 'nullable', 'string', 'max:100'],
            // in-household only; sending it re-homes the entry, omitting it never does
            'baby_id' => ['sometimes', 'nullable', 'integer'],
            'deleted' => ['sometimes', 'boolean'],
        ];
    }
}
