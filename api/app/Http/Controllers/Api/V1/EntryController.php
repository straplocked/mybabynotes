<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\ListEntriesRequest;
use App\Http\Requests\Api\V1\StoreEntryRequest;
use App\Http\Requests\Api\V1\UpdateEntryRequest;
use App\Http\Resources\Api\V1\EntryResource;
use App\Services\EntryWriter;
use Illuminate\Http\Request;

class EntryController extends Controller
{
    /**
     * The log, newest first (sort=-t, the default) or in sync order
     * (sort=rev, pair with updated_after for incremental pulls).
     */
    public function index(ListEntriesRequest $request)
    {
        $data = $request->validated();
        $household = $request->user()->household;

        $query = $household->entries();
        if (isset($data['baby_id'])) {
            // must be one of ours — a guessed id is a 422, not an empty list
            if (! $household->children()->whereKey((int) $data['baby_id'])->exists()) {
                return response()->json(['message' => __('That child isn’t in this log.')], 422);
            }
            $babyId = (int) $data['baby_id'];
            $primaryId = $household->children()->orderBy('id')->value('id');
            // null baby_id rows read as the primary child, so filtering by the
            // primary must include them
            $query->where(fn ($q) => $babyId === $primaryId
                ? $q->where('baby_id', $babyId)->orWhereNull('baby_id')
                : $q->where('baby_id', $babyId));
        }
        if (isset($data['type'])) {
            $query->where('type', $data['type']);
        }
        if (isset($data['t_min'])) {
            $query->where('t', '>=', (int) $data['t_min']);
        }
        if (isset($data['t_max'])) {
            $query->where('t', '<=', (int) $data['t_max']);
        }
        if (isset($data['updated_after'])) {
            $query->where('rev', '>', (int) $data['updated_after']);
        }
        if (! ($data['include_deleted'] ?? false)) {
            $query->where('deleted', false);
        }

        if (($data['sort'] ?? '-t') === 'rev') {
            $query->orderBy('rev'); // rides the (household_id, rev) index
        } else {
            $query->orderByDesc('t')->orderByDesc('id'); // id tiebreak keeps cursors stable
        }

        return EntryResource::collection(
            $query->cursorPaginate((int) ($data['per_page'] ?? 100)),
        );
    }

    public function show(Request $request, string $id)
    {
        return new EntryResource(
            $request->user()->household->entries()->where('id', $id)->firstOrFail(),
        );
    }

    public function store(StoreEntryRequest $request, EntryWriter $writer)
    {
        $data = $request->validated();
        $entry = $writer->create($request->user(), [
            'id' => $data['id'] ?? null,
            'type' => $data['type'],
            't' => $data['t'] ?? now()->getTimestampMs(),
            'detail' => $data['detail'] ?? null,
            'baby_id' => $data['baby_id'] ?? null,
        ]);

        return (new EntryResource($entry))->response()->setStatusCode(201);
    }

    public function update(UpdateEntryRequest $request, EntryWriter $writer, string $id)
    {
        $entry = $writer->update($request->user(), $id, $request->validated());
        if (! $entry) {
            abort(404);
        }

        return new EntryResource($entry);
    }

    /** Tombstone, never a hard delete — the row keeps syncing as deleted. */
    public function destroy(Request $request, EntryWriter $writer, string $id)
    {
        $entry = $writer->tombstone($request->user(), $id);
        if (! $entry) {
            abort(404);
        }

        return new EntryResource($entry);
    }
}
