<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Collection;

class Household extends Model
{
    protected $fillable = ['on_duty_user_id', 'settings', 'active_timers', 'former_members', 'mqtt_config'];

    // mqtt_config is encrypted (broker credentials) and must NEVER appear in
    // /state — SyncController returns `settings` verbatim to every member,
    // which is exactly why this is its own column
    protected $casts = [
        'settings' => 'array',
        'active_timers' => 'array',
        'former_members' => 'array',
        'mqtt_config' => 'encrypted:array',
    ];

    protected $hidden = ['mqtt_config'];

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function children(): HasMany
    {
        return $this->hasMany(Baby::class)->orderBy('id');
    }

    /**
     * The primary (oldest) child — kept for clients that predate multi-child.
     * A plain ordered HasOne (not oldestOfMany) so setBaby's updateOrCreate
     * still writes through it.
     */
    public function baby(): HasOne
    {
        return $this->hasOne(Baby::class)->orderBy('id');
    }

    public function invites(): HasMany
    {
        return $this->hasMany(Invite::class);
    }

    public function entries(): HasMany
    {
        return $this->hasMany(Entry::class);
    }

    public function shifts(): HasMany
    {
        return $this->hasMany(Shift::class);
    }

    /** Every member except the given one, in id order. */
    public function othersFor(User $user): Collection
    {
        return $this->users->where('id', '!=', $user->id)->sortBy('id')->values();
    }

    /** Legacy accessor: "the other grown-up" — now simply the first other member. */
    public function partnerOf(User $user): ?User
    {
        return $this->othersFor($user)->first();
    }

    /**
     * Running timers in start order, so client rows stay put as new ones append.
     *
     * @return list<array{id: string, type: string, started_at: int, user_id: int, baby_id: int|null}>
     */
    public function runningTimers(): array
    {
        $timers = array_values($this->active_timers ?? []);
        usort($timers, fn ($a, $b) => ($a['started_at'] ?? 0) <=> ($b['started_at'] ?? 0));

        return $timers;
    }

    /**
     * Legacy singular slot for pre-multi-timer clients: the viewer's own newest
     * timer (their Stop button must act on something they started), else the
     * household's newest.
     *
     * @return array{id: string, type: string, started_at: int, user_id: int, baby_id: int|null}|null
     */
    public function legacyTimerFor(?User $user = null): ?array
    {
        $timers = $this->runningTimers();
        $mine = $user ? array_filter($timers, fn ($t) => ($t['user_id'] ?? null) === $user->id) : [];

        return $mine ? end($mine) : ($timers ? end($timers) : null);
    }
}
