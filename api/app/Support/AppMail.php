<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Support;

/**
 * One switch for every email feature. Self-hosted instances ship with
 * MAIL_MAILER=log, which means "this instance can't actually send" — invites
 * fall back to the shareable code and password reset explains itself instead
 * of silently writing mail into a log nobody reads.
 */
class AppMail
{
    public static function configured(): bool
    {
        return config('mail.default') !== 'log';
    }
}
