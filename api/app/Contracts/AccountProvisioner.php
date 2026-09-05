<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Contracts;

use App\Models\Household;

/**
 * What happens when someone registers without an invite: may the registration
 * proceed at all, and which household does the new account land in?
 *
 * Invited registrations never reach the provisioner — the invite decides the
 * household and seat. Swap the implementation via babylog.account_provisioner
 * to change the uninvited-registration policy without touching the auth flow,
 * e.g. a deployment that provisions a fresh household per signup instead of
 * claiming the instance.
 */
interface AccountProvisioner
{
    /**
     * @throws \Illuminate\Validation\ValidationException when the registration is refused
     */
    public function provision(string $email): Household;
}
