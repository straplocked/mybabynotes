<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Console\Commands;

use App\Events\HouseholdTouched;
use App\Models\User;
use Illuminate\Console\Command;

/**
 * Admin-side twin of the /household/remove-member endpoint, for when no
 * parent can do it from the app (the remover IS the problem account, or every
 * parent seat is locked out). Same semantics: sessions and push subscriptions
 * die, duty and in-flight shifts are tidied, and the name is snapshotted into
 * former_members so their old entries keep an attribution chip.
 */
class RemoveUser extends Command
{
    protected $signature = 'babylog:remove-user
        {email : The account\'s email address}
        {--force : Skip the confirmation prompt (required when run non-interactively)}';

    protected $description = 'Remove one member from their household (entries they logged stay)';

    public function handle(): int
    {
        $target = User::where('email', strtolower(trim($this->argument('email'))))->first();
        if (! $target) {
            $this->error('No account with that email. `babylog:users` lists everyone.');

            return self::FAILURE;
        }

        $household = $target->household;
        // the last member leaving would strand the household's data behind a
        // fresh instance claim — deleting the household is the honest version
        if ($household && $household->users()->count() === 1) {
            $this->error(sprintf(
                '%s is the only member of household #%d — removing them would orphan its data. Use `babylog:delete-household %d` to un-claim it instead.',
                $target->email, $household->id, $household->id,
            ));

            return self::FAILURE;
        }

        $this->line(sprintf('Removing [%d] %s <%s> from household #%s. Entries they logged stay.', $target->id, $target->name, $target->email, $household?->id ?? '—'));
        if (! $this->option('force') && ! $this->confirm('Remove this member?')) {
            $this->line('Nothing removed.');

            return self::FAILURE;
        }

        $target->tokens()->delete();            // every session 401s from here on
        $target->pushSubscriptions()->delete(); // no more pushes at their devices

        if ($household) {
            // duty can't sit with someone who's gone; hand it to the oldest
            // remaining member (a parent when there is one)
            $rest = $household->users()->where('id', '!=', $target->id)->orderBy('id')->get();
            if ($household->on_duty_user_id === $target->id) {
                $next = $rest->first(fn (User $u) => $u->isParent()) ?? $rest->first();
                $household->update(['on_duty_user_id' => $next?->id]);
            }
            $household->shifts()->where('state', 'requested')->where('requester_id', $target->id)
                ->update(['state' => 'cancelled']);
            $household->shifts()->where('state', 'active')->where('user_id', $target->id)
                ->update(['state' => 'cancelled', 'ended_at' => now()->getTimestampMs()]);

            $former = collect($household->former_members ?? [])
                ->reject(fn ($m) => (int) ($m['id'] ?? 0) === $target->id)
                ->push(['id' => $target->id, 'name' => $target->name])
                ->values()->all();
            $household->update(['former_members' => $former]);
        }

        $target->delete();

        if ($household) {
            HouseholdTouched::send($household->id, 'members');
        }

        $this->info(sprintf('Removed %s. Remaining members see the change on their next sync.', $target->email));

        return self::SUCCESS;
    }
}
