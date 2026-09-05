<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Resources\Api\V1;

use App\Models\Baby;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One log entry as the public API presents it. Internally a null baby_id
 * means "the primary child" (a legacy-client rule); here it resolves to the
 * primary child's concrete id so integrators never learn that rule.
 */
class EntryResource extends JsonResource
{
    /** @var array<int, int|null> per-request memo: household_id => primary child id */
    private static array $primary = [];

    public static function resetPrimaryMemo(): void
    {
        self::$primary = [];
    }

    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'baby_id' => $this->baby_id ?? self::primaryChildId($this->household_id),
            'user_id' => $this->user_id,
            'type' => $this->type,
            't' => (int) $this->t,
            'detail' => $this->detail,
            'deleted' => (bool) $this->deleted,
            'rev' => (int) $this->rev,
        ];
    }

    private static function primaryChildId(int $householdId): ?int
    {
        return self::$primary[$householdId] ??= Baby::query()
            ->where('household_id', $householdId)->orderBy('id')->value('id');
    }
}
