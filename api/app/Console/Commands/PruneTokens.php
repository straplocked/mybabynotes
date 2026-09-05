<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Laravel\Sanctum\PersonalAccessToken;

class PruneTokens extends Command
{
    protected $signature = 'babylog:prune-tokens {--hours=168 : Grace period after expiry before a token row is reaped}';

    protected $description = 'Prune expired tokens, honoring the sliding window for app tokens and expires_at for personal access tokens';

    // sanctum:prune-expired reaps by created_at age alone, which deletes an
    // actively-used app token ~97 days after login and would kill no-expiry
    // PATs. This command mirrors the validity rules in AppServiceProvider:
    // app tokens die only when *idle* past the window; PATs only past their
    // explicit expires_at; no-expiry PATs live forever.
    public function handle(): int
    {
        $grace = (int) $this->option('hours');

        $pats = PersonalAccessToken::query()
            ->where('name', '!=', 'app')
            ->whereNotNull('expires_at')
            ->where('expires_at', '<', now()->subHours($grace))
            ->delete();

        $apps = 0;
        if (($minutes = config('sanctum.expiration')) !== null) {
            $cutoff = now()->subMinutes($minutes)->subHours($grace);
            $apps = PersonalAccessToken::query()
                ->where('name', 'app')
                ->where(fn ($q) => $q
                    ->where('last_used_at', '<', $cutoff)
                    ->orWhere(fn ($q2) => $q2->whereNull('last_used_at')->where('created_at', '<', $cutoff)))
                ->delete();
        }

        $this->info("Pruned {$apps} idle app token(s) and {$pats} expired personal access token(s).");

        return self::SUCCESS;
    }
}
