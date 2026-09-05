<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

#[Fillable(['name', 'email', 'password', 'household_id', 'role', 'notify_prefs', 'notify_state'])]
#[Hidden(['password', 'remember_token', 'notify_state'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    /**
     * Per-parent notification defaults. Handoffs are the one thing on out of
     * the box — a partner asking you to take over should actually reach you.
     */
    public const NOTIFY_DEFAULTS = [
        'handoff' => true,      // shift request / accept / handback
        'timer' => true,        // partner started a nursing / pump timer
        'partner' => false,     // "your partner logged something"
        'feed' => false,        // feed-gap reminder
        'feedEvery' => null,    // minutes between feeds; null = learned household rhythm
        'feedEveryByChild' => [], // per-child override: childId => minutes; unset children inherit feedEvery
        'onDutyOnly' => true,   // feed reminders only while I'm on duty
        'wake' => false,        // awake past the age-typical wake window
        'meds' => false,        // daily meds reminder
        'medsTime' => '09:00',
        'quiet' => false,       // quiet hours silence reminders; handoffs still deliver
        'quietStart' => '22:00',
        'quietEnd' => '07:00',
        'tz' => null,           // IANA zone from the device, for quiet hours + meds time
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'notify_prefs' => 'array',
            'notify_state' => 'array',
        ];
    }

    /** Parents run the household; caregivers only log, run timers, and trade shifts. */
    public function isParent(): bool
    {
        return $this->role !== 'caregiver';
    }

    public function household(): BelongsTo
    {
        return $this->belongsTo(Household::class);
    }

    public function pushSubscriptions(): HasMany
    {
        return $this->hasMany(PushSubscription::class);
    }

    /** Stored prefs over defaults — always a complete set of keys. */
    public function notifyPrefs(): array
    {
        return array_merge(self::NOTIFY_DEFAULTS, $this->notify_prefs ?? []);
    }

    /** True while this user's quiet-hours window (in their own timezone) is active. */
    public function inQuietHours(): bool
    {
        $p = $this->notifyPrefs();
        if (! $p['quiet']) {
            return false;
        }
        try {
            $now = now($p['tz'] ?: config('app.timezone'));
        } catch (\Throwable) {
            $now = now();
        }
        $mins = $now->hour * 60 + $now->minute;
        $toMins = function (string $hm): int {
            [$h, $m] = explode(':', $hm);

            return (int) $h * 60 + (int) $m;
        };
        $start = $toMins($p['quietStart']);
        $end = $toMins($p['quietEnd']);

        // a window like 22:00–07:00 wraps midnight
        return $start <= $end ? ($mins >= $start && $mins < $end) : ($mins >= $start || $mins < $end);
    }
}
