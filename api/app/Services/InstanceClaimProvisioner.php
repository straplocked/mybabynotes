<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Services;

use App\Contracts\AccountProvisioner;
use App\Models\Household;
use App\Models\User;
use Illuminate\Validation\ValidationException;

/**
 * The appliance default: the first account claims the instance; after that,
 * uninvited registration is refused unless BABYLOG_OPEN_REGISTRATION is on.
 */
class InstanceClaimProvisioner implements AccountProvisioner
{
    public function provision(string $email): Household
    {
        if (! config('babylog.open_registration') && User::count() > 0) {
            throw ValidationException::withMessages([
                'email' => ['This mybabynotes is invite-only. Ask your partner to invite this exact email.'],
            ]);
        }

        return Household::create();
    }
}
