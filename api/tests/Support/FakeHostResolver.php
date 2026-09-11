<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace Tests\Support;

use App\Contracts\HostResolver;

/**
 * DNS as a map, so the suite never touches the network. Hosts not in the
 * map don't resolve (the same as a typo'd push relay would).
 */
class FakeHostResolver implements HostResolver
{
    /** @param array<string, list<string>> $hosts */
    public function __construct(public array $hosts = []) {}

    public function resolve(string $host): array
    {
        return $this->hosts[strtolower($host)] ?? [];
    }
}
