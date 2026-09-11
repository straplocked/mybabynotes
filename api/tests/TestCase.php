<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace Tests;

use App\Contracts\HostResolver;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Tests\Support\FakeHostResolver;

abstract class TestCase extends BaseTestCase
{
    /** The push endpoint host the suite subscribes with, as a public address. */
    public const PUSH_HOST_IP = '203.0.113.7';

    protected function setUp(): void
    {
        parent::setUp();

        // no test ever does real DNS: push.example is "a public relay", and a
        // test that wants another answer binds its own FakeHostResolver
        $this->app->instance(HostResolver::class, new FakeHostResolver([
            'push.example' => [self::PUSH_HOST_IP],
        ]));
    }
}
