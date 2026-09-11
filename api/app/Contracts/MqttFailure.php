<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Contracts;

/**
 * Why a broker connection failed, reduced to what a parent can act on. The
 * driver's own text (hostnames, ports, OpenSSL internals) stays in the server
 * log — the client only ever sees which of these three buckets it landed in.
 */
enum MqttFailure: string
{
    case Unreachable = 'unreachable';
    case Credentials = 'credentials';
    case Tls = 'tls';
}
