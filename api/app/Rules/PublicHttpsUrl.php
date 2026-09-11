<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Rules;

use App\Contracts\HostResolver;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * A URL the server is allowed to POST to on a user's say-so — the Web Push
 * endpoint a device hands us at subscribe time. Without this, /push/subscribe
 * is a request-forgery primitive: any signed-in user could point "their
 * device" at the docker network, the NAS's own admin port, or a cloud
 * metadata address and have every later write POST there from inside.
 *
 * https only (browsers never issue http push endpoints), a real multi-label
 * hostname (no localhost / .local / .internal / bare names), and nothing that
 * is or resolves to a private, loopback, link-local, CGNAT, ULA or otherwise
 * non-global address. There's deliberately no vendor allowlist: a self-hosted
 * push relay on a public name works, a LAN-only one doesn't.
 *
 * DNS is checked once, here — see docs/known-limitations.md on rebinding.
 */
class PublicHttpsUrl implements ValidationRule
{
    /** v4 blocks that are never a public push service (CIDR). */
    private const V4_BLOCKED = [
        '0.0.0.0/8',        // "this" network
        '10.0.0.0/8',       // private
        '100.64.0.0/10',    // carrier-grade NAT
        '127.0.0.0/8',      // loopback
        '169.254.0.0/16',   // link-local (and cloud metadata)
        '172.16.0.0/12',    // private
        '192.168.0.0/16',   // private
        '224.0.0.0/4',      // multicast
        '240.0.0.0/4',      // reserved + broadcast
    ];

    /** v6 blocks; v4-mapped (::ffff:0:0/96) and NAT64 (64:ff9b::/96) are unwrapped and judged as v4. */
    private const V6_BLOCKED = [
        '::/128',           // unspecified
        '::1/128',          // loopback
        'fc00::/7',         // unique local
        'fe80::/10',        // link-local
        'ff00::/8',         // multicast
    ];

    public function __construct(private ?HostResolver $resolver = null) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value) || ! $this->isPublicHttps($value)) {
            $fail(__('Push endpoint must be a public https URL.'));
        }
    }

    public function isPublicHttps(string $url): bool
    {
        $parts = parse_url($url);
        if (! is_array($parts) || strtolower($parts['scheme'] ?? '') !== 'https') {
            return false;
        }
        $host = strtolower(rtrim($parts['host'] ?? '', '.'));
        if ($host === '') {
            return false;
        }

        // an IP literal is judged directly (parse_url keeps v6 brackets)
        $literal = trim($host, '[]');
        if (filter_var($literal, FILTER_VALIDATE_IP) !== false) {
            return ! self::isNonPublicIp($literal);
        }

        if ($host === 'localhost' || ! str_contains($host, '.')) {
            return false;
        }
        foreach (['.local', '.internal', '.localhost'] as $suffix) {
            if (str_ends_with($host, $suffix)) {
                return false;
            }
        }

        $ips = ($this->resolver ?? app(HostResolver::class))->resolve($host);
        if ($ips === []) {
            return false;
        }
        foreach ($ips as $ip) {
            if (self::isNonPublicIp($ip)) {
                return false;
            }
        }

        return true;
    }

    /** True for anything in the blocked ranges above; unparsable input counts as non-public. */
    public static function isNonPublicIp(string $ip): bool
    {
        $packed = @inet_pton($ip);
        if ($packed === false) {
            return true;
        }
        if (strlen($packed) === 16) {
            // ::ffff:a.b.c.d and 64:ff9b::a.b.c.d carry a v4 address — judge that one
            foreach (["\0\0\0\0\0\0\0\0\0\0\xff\xff", "\x00\x64\xff\x9b\0\0\0\0\0\0\0\0"] as $prefix) {
                if (str_starts_with($packed, $prefix)) {
                    return self::inAny(substr($packed, 12), self::V4_BLOCKED);
                }
            }

            return self::inAny($packed, self::V6_BLOCKED);
        }

        return self::inAny($packed, self::V4_BLOCKED);
    }

    /** @param list<string> $cidrs */
    private static function inAny(string $packed, array $cidrs): bool
    {
        foreach ($cidrs as $cidr) {
            [$net, $bits] = explode('/', $cidr);
            $netPacked = inet_pton($net);
            if ($netPacked === false || strlen($netPacked) !== strlen($packed)) {
                continue;
            }
            $bits = (int) $bits;
            $fullBytes = intdiv($bits, 8);
            if ($fullBytes > 0 && substr($packed, 0, $fullBytes) !== substr($netPacked, 0, $fullBytes)) {
                continue;
            }
            $rest = $bits % 8;
            if ($rest === 0) {
                return true;
            }
            $mask = (0xFF << (8 - $rest)) & 0xFF;
            if ((ord($packed[$fullBytes]) & $mask) === (ord($netPacked[$fullBytes]) & $mask)) {
                return true;
            }
        }

        return false;
    }
}
