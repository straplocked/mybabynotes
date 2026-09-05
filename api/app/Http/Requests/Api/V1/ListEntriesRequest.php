<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

class ListEntriesRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'baby_id' => ['sometimes', 'integer'],
            'type' => ['sometimes', 'string', 'max:20'],
            't_min' => ['sometimes', 'integer'],
            't_max' => ['sometimes', 'integer'],
            'updated_after' => ['sometimes', 'integer'],
            'include_deleted' => ['sometimes', 'boolean'],
            'sort' => ['sometimes', 'string', 'in:-t,rev'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:500'],
            'cursor' => ['sometimes', 'string'],
        ];
    }
}
