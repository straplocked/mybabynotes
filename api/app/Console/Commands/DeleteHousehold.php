<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Console\Commands;

use App\Models\Household;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * The surgical un-claim: delete ONE household — its members, children,
 * entries, shifts and invites — leaving the rest of the instance (secrets,
 * VAPID keys, any other households) alone. When the last household goes, the
 * next sign-up claims the instance fresh; before this command the only way
 * there was babylog-reset-data, which wipes the whole database file.
 */
class DeleteHousehold extends Command
{
    protected $signature = 'babylog:delete-household
        {household : The household id (see babylog:users)}
        {--force : Skip the confirmation prompt (required when run non-interactively)}';

    protected $description = 'Delete a household and everything in it (the un-claim without a full data wipe)';

    public function handle(): int
    {
        $household = Household::with(['users', 'children'])->withCount('entries')->find((int) $this->argument('household'));
        if (! $household) {
            $this->error('No household with that id. `babylog:users` lists them.');

            return self::FAILURE;
        }

        $this->line(sprintf(
            'Household #%d: %d entries, %s, %s.',
            $household->id,
            $household->entries_count,
            $household->children->count().' child'.($household->children->count() === 1 ? '' : 'ren'),
            $household->users->isEmpty() ? 'no members' : 'members '.$household->users->pluck('email')->join(', '),
        ));
        $this->line('This deletes all of it. There is no undo.');
        if (! $this->option('force') && ! $this->confirm('Delete this household?')) {
            $this->line('Nothing deleted.');

            return self::FAILURE;
        }

        DB::transaction(function () use ($household) {
            // children of the household rows first — none of these FKs cascade
            $household->entries()->delete();
            $household->shifts()->delete();
            $household->children()->delete();
            foreach ($household->users as $user) {
                $user->tokens()->delete(); // token rows are morphs, no FK to cascade
                $user->delete();           // push subscriptions cascade off the user
            }
            $household->delete();          // invites cascade off the household
        });

        $this->info(sprintf('Household #%d deleted.', $household->id));
        if (User::count() === 0) {
            $this->line('No accounts remain — the next sign-up claims this instance.');
        }

        return self::SUCCESS;
    }
}
