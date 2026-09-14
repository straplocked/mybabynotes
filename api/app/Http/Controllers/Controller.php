<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

abstract class Controller
{
    /**
     * Caregivers log, run timers, and cover; only parents shape the household
     * itself. Lives here because two controllers gate on it now — the
     * household-shaping endpoints in SyncController, and /shifts/assign, which
     * writes duty onto somebody else's name.
     */
    protected function parentsOnly(Request $request): ?JsonResponse
    {
        return $request->user()->isParent()
            ? null
            : response()->json(['message' => __('Only a parent can change that.')], 403);
    }
}
