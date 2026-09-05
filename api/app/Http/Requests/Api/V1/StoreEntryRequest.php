<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Create one entry. `type` is a free string for parity with the sync
 * protocol; bottle, nurse, pump, wet, dirty, both, sleep, bath, meds are the
 * conventional vocabulary (see docs/integrations.md for detail semantics).
 */
class StoreEntryRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            // client-generated UUID optional; the server generates one if absent
            'id' => ['sometimes', 'string', 'max:64'],
            'type' => ['required', 'string', 'max:20'],
            // event time, ms since epoch; defaults to now
            't' => ['sometimes', 'integer'],
            'detail' => ['sometimes', 'nullable', 'string', 'max:100'],
            'baby_id' => ['sometimes', 'nullable', 'integer'],
        ];
    }
}
