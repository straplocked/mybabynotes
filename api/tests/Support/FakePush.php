<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace Tests\Support;

use App\Models\User;
use App\Services\PushService;

/** Captures notify() calls instead of talking to browser push services. */
class FakePush extends PushService
{
    /** @var array<int, array{user: int, tag: string, title: string, body: string}> */
    public array $sent = [];

    public function notify(User $user, string $tag, string $title, string $body): void
    {
        $this->sent[] = ['user' => $user->id, 'tag' => $tag, 'title' => $title, 'body' => $body];
    }

    public function to(int $userId): array
    {
        return array_values(array_filter($this->sent, fn ($n) => $n['user'] === $userId));
    }
}
