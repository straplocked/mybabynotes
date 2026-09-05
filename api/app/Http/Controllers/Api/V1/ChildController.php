<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\Api\V1\ChildResource;
use Illuminate\Http\Request;

class ChildController extends Controller
{
    /** All children, id-ordered — the first is the primary child. */
    public function index(Request $request)
    {
        return ChildResource::collection($request->user()->household->children);
    }

    public function show(Request $request, int $id)
    {
        // scoped find: a foreign or unknown id is a 404, never a peek
        return new ChildResource($request->user()->household->children()->findOrFail($id));
    }
}
