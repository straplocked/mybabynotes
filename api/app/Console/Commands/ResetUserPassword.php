<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * The no-SMTP escape hatch: on an instance without mail configured, "Forgot
 * password?" can't send a link, and a locked-out parent used to need tinker
 * surgery (or a full babylog-reset-data wipe). This sets a fresh password
 * from the command line instead — hand it to the person out-of-band and have
 * them change it in Settings once they're back in.
 */
class ResetUserPassword extends Command
{
    protected $signature = 'babylog:reset-password
        {email : The account\'s email address}
        {--password= : Password to set (min 8 chars); omitted, a random one is generated and printed}';

    protected $description = 'Set a new password for an account (for locked-out users on SMTP-less instances)';

    public function handle(): int
    {
        $user = User::where('email', strtolower(trim($this->argument('email'))))->first();
        if (! $user) {
            $this->error('No account with that email. `babylog:users` lists everyone.');

            return self::FAILURE;
        }

        $password = $this->option('password');
        if ($password !== null && strlen($password) < 8) {
            $this->error('Password must be at least 8 characters.');

            return self::FAILURE;
        }
        // no symbols: this gets read aloud or typed once on a phone keyboard
        $password ??= Str::password(14, symbols: false);

        $user->forceFill(['password' => $password])->save(); // hashed by the cast
        $user->tokens()->delete(); // old sessions die with the old password, like the reset-link flow

        $this->info(sprintf('Password reset for %s <%s>.', $user->name, $user->email));
        $this->line('New password: '.$password);
        $this->line('Every device is signed out — log in with this, then change it in Settings.');

        return self::SUCCESS;
    }
}
