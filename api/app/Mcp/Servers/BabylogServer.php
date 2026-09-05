<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Mcp\Servers;

use App\Mcp\Resources\HouseholdOverview;
use App\Mcp\Tools\DeleteEntry;
use App\Mcp\Tools\GetDailySummary;
use App\Mcp\Tools\GetHouseholdStatus;
use App\Mcp\Tools\GetTimer;
use App\Mcp\Tools\ListChildren;
use App\Mcp\Tools\ListEntries;
use App\Mcp\Tools\LogEntry;
use App\Mcp\Tools\StartTimer;
use App\Mcp\Tools\StopTimer;
use App\Mcp\Tools\UpdateEntry;
use Laravel\Mcp\Server;
use Laravel\Mcp\Server\Attributes\Instructions;
use Laravel\Mcp\Server\Attributes\Name;
use Laravel\Mcp\Server\Attributes\Version;

/**
 * Deliberately no household-management tools (children, invites, members,
 * settings): every tool here is legal for caregivers as well as parents, so
 * role enforcement is structural. If a management tool is ever added it must
 * gate on User::isParent() with the same 403 wording as the internal API,
 * and McpTest's parent-only sweep must learn about it.
 */
#[Name('MyBabyNotes')]
#[Version('1.0.0')]
#[Instructions(<<<'MD'
MyBabyNotes tracks a household's baby care log. Entries have a type — bottle,
nurse, pump, wet, dirty, both (a wet+dirty diaper), sleep, tummy (tummy time),
bath, meds — plus a time and a type-specific `detail` string: ounces for
bottle/pump, the side for nurse (e.g. "L"), minutes for sleep/tummy (sleep may
carry a Nap/Night tag, e.g. "Nap · 45m"). Amounts are always stored in ounces even
if the household displays milliliters. A household can have multiple children;
tools default to the primary (oldest) child when no baby_id is given. Deletes
are tombstones and every write syncs live to the parents' phones, so log only
what the user actually asked you to log.
MD)]
class BabylogServer extends Server
{
    protected array $tools = [
        ListChildren::class,
        ListEntries::class,
        GetHouseholdStatus::class,
        GetDailySummary::class,
        LogEntry::class,
        UpdateEntry::class,
        DeleteEntry::class,
        GetTimer::class,
        StartTimer::class,
        StopTimer::class,
    ];

    protected array $resources = [
        HouseholdOverview::class,
    ];
}
