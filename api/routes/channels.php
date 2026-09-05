<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('household.{id}', function ($user, $id) {
    return (int) $user->household_id === (int) $id;
});
