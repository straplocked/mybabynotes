<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Contracts;

/**
 * Hostname → addresses, behind an interface so validation that needs DNS
 * (PublicHttpsUrl) can be exercised without the test suite touching the
 * network. Production binds DnsHostResolver; tests bind a map.
 */
interface HostResolver
{
    /**
     * Every A and AAAA address the host resolves to, as strings. Empty when
     * it doesn't resolve at all — callers treat that as "not reachable".
     *
     * @return list<string>
     */
    public function resolve(string $host): array;
}
