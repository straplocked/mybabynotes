<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace Tests\Support;

/**
 * Shared helpers for feature suites (BabylogApiTest keeps private copies for
 * now — its 1100 lines stay byte-identical; new suites use this trait).
 */
trait BabylogTestHelpers
{
    protected function register(string $name, string $email, string $password = 'password123')
    {
        return $this->postJson('/api/register', ['name' => $name, 'email' => $email, 'password' => $password]);
    }

    protected function authed(string $token): array
    {
        // guards cache the resolved user across requests within one test —
        // reset so each request authenticates as its own token's user
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$token];
    }

    /** Ben (parent) + Katrina (parent) + Robin the doula (caregiver), one household. */
    protected function threeMemberHousehold(): array
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $codeKat = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $kat = $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $codeKat])->json('token');
        $codeDoula = $this->postJson('/api/invite', ['email' => 'doula@example.com', 'role' => 'caregiver'], $this->authed($ben))->json('code');
        $doula = $this->postJson('/api/register', ['name' => 'Robin', 'email' => 'doula@example.com', 'password' => 'password123', 'invite' => $codeDoula])->json('token');

        return [$ben, $kat, $doula];
    }

    /** Mint a personal access token for the user who owns $appToken. */
    protected function mintPat(string $appToken, array $abilities, ?int $expiresInDays = 90, string $name = 'Test token'): string
    {
        $body = ['name' => $name, 'abilities' => $abilities];
        if ($expiresInDays !== 90) {
            $body['expires_in_days'] = $expiresInDays;
        }

        return $this->postJson('/api/tokens', $body, $this->authed($appToken))
            ->assertCreated()->json('token');
    }
}
