<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Console\Commands;

use App\Models\Household;
use Illuminate\Console\Command;

/**
 * The admin's read-only map of the instance: who claimed it, who's in which
 * household, and what the other babylog:* commands would be acting on. Runs
 * via `docker exec` (Unraid has no SSH; User Scripts drives it) — see
 * docs/operations.md "Admin commands".
 */
class UsersOverview extends Command
{
    protected $signature = 'babylog:users';

    protected $description = 'List every household with its members, children, invites and entry count';

    public function handle(): int
    {
        $households = Household::with(['users', 'children', 'invites'])->withCount('entries')->orderBy('id')->get();
        if ($households->isEmpty()) {
            $this->info('No accounts yet — the next sign-up claims this instance.');

            return self::SUCCESS;
        }

        foreach ($households as $h) {
            $this->line(sprintf(
                'Household #%d — %d member%s, %d child%s, %d entr%s',
                $h->id,
                $h->users->count(), $h->users->count() === 1 ? '' : 's',
                $h->children->count(), $h->children->count() === 1 ? '' : 'ren',
                $h->entries_count, $h->entries_count === 1 ? 'y' : 'ies',
            ));
            foreach ($h->users->sortBy('id') as $u) {
                $this->line(sprintf(
                    '  [%d] %s <%s> · %s%s · joined %s',
                    $u->id, $u->name, $u->email, $u->role ?? 'parent',
                    $h->on_duty_user_id === $u->id ? ' · on duty' : '',
                    $u->created_at?->toDateString() ?? '?',
                ));
            }
            foreach ($h->children as $c) {
                $this->line(sprintf('  child: %s%s%s', $c->name, $c->birthdate ? ' · born '.$c->birthdate : '', $c->archived ? ' · archived' : ''));
            }
            foreach ($h->invites as $i) {
                $this->line(sprintf('  invite pending: %s (%s)', $i->email, $i->role));
            }
            foreach ($h->former_members ?? [] as $m) {
                $this->line(sprintf('  former member: [%d] %s', $m['id'] ?? 0, $m['name'] ?? '?'));
            }
        }

        return self::SUCCESS;
    }
}
