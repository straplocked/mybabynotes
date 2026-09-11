<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Services;

use App\Contracts\HostResolver;

/** The real thing: system DNS via dns_get_record, A and AAAA. */
class DnsHostResolver implements HostResolver
{
    public function resolve(string $host): array
    {
        $ips = [];
        foreach ([DNS_A => 'ip', DNS_AAAA => 'ipv6'] as $type => $field) {
            try {
                $records = @dns_get_record($host, $type);
            } catch (\Throwable) {
                $records = false;
            }
            foreach ($records ?: [] as $record) {
                if (isset($record[$field]) && is_string($record[$field])) {
                    $ips[] = $record[$field];
                }
            }
        }

        return array_values(array_unique($ips));
    }
}
