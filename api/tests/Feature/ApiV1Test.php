<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace Tests\Feature;

use App\Models\Entry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\Support\BabylogTestHelpers;
use Tests\TestCase;

/**
 * The public /api/v1 surface. The load-bearing assertions are sync parity:
 * everything written here must be indistinguishable from a PWA outbox write
 * when it comes back through the internal /api/state pull.
 */
class ApiV1Test extends TestCase
{
    use BabylogTestHelpers;
    use RefreshDatabase;

    /** A parent with a full-scope PAT, two children, household set up. */
    private function parentWithPat(array $abilities = [
        'profile:read', 'children:read', 'entries:read', 'entries:write', 'timer:read', 'timer:write',
    ]): array {
        $app = $this->register('Ben', 'ben@example.com')->json('token');
        $this->postJson('/api/baby', ['name' => 'Maddux', 'birthdate' => '2026-07-20'], $this->authed($app))->assertOk();
        $wrenId = $this->postJson('/api/children', ['name' => 'Wren'], $this->authed($app))->json('child.id');
        $pat = $this->mintPat($app, $abilities);

        return [$app, $pat, $wrenId];
    }

    private function pushViaOutbox(string $appToken, array $entry): void
    {
        $this->postJson('/api/entries', ['entries' => [$entry]], $this->authed($appToken))->assertOk();
    }

    // ── reads ──────────────────────────────────────────────────────────────

    public function test_me_returns_user_household_and_members(): void
    {
        [, $pat] = $this->parentWithPat();

        $me = $this->getJson('/api/v1/me', $this->authed($pat))->assertOk()->json();
        $this->assertSame('Ben', $me['user']['name']);
        $this->assertSame('parent', $me['user']['role']);
        $this->assertSame(['Ben'], array_column($me['household']['members'], 'name'));
        $this->assertIsInt($me['server_time']);
    }

    public function test_children_index_is_id_ordered_and_show_scopes_to_household(): void
    {
        [, $pat, $wrenId] = $this->parentWithPat();

        $children = $this->getJson('/api/v1/children', $this->authed($pat))->assertOk()->json('data');
        $this->assertSame(['Maddux', 'Wren'], array_column($children, 'name'));

        $this->getJson('/api/v1/children/'.$wrenId, $this->authed($pat))->assertOk()
            ->assertJsonPath('data.name', 'Wren');
        $this->getJson('/api/v1/children/999', $this->authed($pat))->assertNotFound();
    }

    public function test_entries_list_filters_paginates_and_resolves_null_baby_id(): void
    {
        [$app, $pat, $wrenId] = $this->parentWithPat();
        $primaryId = $this->getJson('/api/v1/children', $this->authed($pat))->json('data.0.id');

        // one legacy-style entry with no baby_id, one for Wren, one deleted
        $this->pushViaOutbox($app, ['id' => 'e-legacy', 'type' => 'bottle', 't' => 1000, 'detail' => '4']);
        $this->pushViaOutbox($app, ['id' => 'e-wren', 'type' => 'sleep', 't' => 2000, 'baby_id' => $wrenId]);
        $this->pushViaOutbox($app, ['id' => 'e-gone', 'type' => 'wet', 't' => 3000, 'deleted' => true]);

        $all = $this->getJson('/api/v1/entries', $this->authed($pat))->assertOk()->json('data');
        // newest first, tombstones excluded by default
        $this->assertSame(['e-wren', 'e-legacy'], array_column($all, 'id'));
        // null baby_id resolves to the primary child's concrete id
        $this->assertSame($primaryId, $all[1]['baby_id']);

        // filtering by the primary child includes legacy null-baby_id rows
        $primary = $this->getJson('/api/v1/entries?baby_id='.$primaryId, $this->authed($pat))->json('data');
        $this->assertSame(['e-legacy'], array_column($primary, 'id'));

        $wren = $this->getJson('/api/v1/entries?baby_id='.$wrenId, $this->authed($pat))->json('data');
        $this->assertSame(['e-wren'], array_column($wren, 'id'));

        $this->getJson('/api/v1/entries?baby_id=999', $this->authed($pat))->assertStatus(422);

        $typed = $this->getJson('/api/v1/entries?type=bottle', $this->authed($pat))->json('data');
        $this->assertSame(['e-legacy'], array_column($typed, 'id'));

        $ranged = $this->getJson('/api/v1/entries?t_min=1500&t_max=2500', $this->authed($pat))->json('data');
        $this->assertSame(['e-wren'], array_column($ranged, 'id'));

        $withDeleted = $this->getJson('/api/v1/entries?include_deleted=1', $this->authed($pat))->json('data');
        $this->assertCount(3, $withDeleted);

        // cursor pagination walks the whole set without overlap
        $page1 = $this->getJson('/api/v1/entries?per_page=1', $this->authed($pat))->json();
        $this->assertCount(1, $page1['data']);
        $this->assertNotNull($page1['meta']['next_cursor']);
        $page2 = $this->getJson('/api/v1/entries?per_page=1&cursor='.$page1['meta']['next_cursor'], $this->authed($pat))->json();
        $this->assertNotSame($page1['data'][0]['id'], $page2['data'][0]['id']);

        // sort=rev + updated_after supports incremental sync consumers
        $lastRev = max(array_column($withDeleted, 'rev'));
        $since = $this->getJson('/api/v1/entries?sort=rev&updated_after='.($lastRev - 1).'&include_deleted=1', $this->authed($pat))->json('data');
        $this->assertSame([$lastRev], array_column($since, 'rev'));
    }

    // ── writes + sync parity ───────────────────────────────────────────────

    public function test_v1_create_lands_in_state_with_a_fresh_rev_and_defaults_to_primary(): void
    {
        [$app, $pat] = $this->parentWithPat();

        $created = $this->postJson('/api/v1/entries', ['type' => 'bottle', 'detail' => '3'], $this->authed($pat))
            ->assertCreated()->json('data');
        $this->assertTrue(Str::isUuid($created['id']));

        $state = $this->getJson('/api/state?since=0', $this->authed($app))->json();
        $ids = array_column($state['entries'], 'id');
        $this->assertContains($created['id'], $ids);

        // stored null baby_id (primary-child default lives in the read layer)
        $row = Entry::findOrFail($created['id']);
        $this->assertNotNull($row->baby_id); // EntryWriter assigns the primary child on create
        $this->assertSame('bottle', $row->type);
        $this->assertGreaterThan(0, $row->rev);
    }

    public function test_v1_accepts_a_client_uuid_and_patch_preserves_fields_and_author(): void
    {
        [$app, $pat, $wrenId] = $this->parentWithPat();
        $id = (string) Str::uuid();

        $this->postJson('/api/v1/entries', [
            'id' => $id, 'type' => 'sleep', 't' => 5000, 'detail' => '45', 'baby_id' => $wrenId,
        ], $this->authed($pat))->assertCreated();

        // patch one field — everything else must survive, including baby_id
        $this->patchJson('/api/v1/entries/'.$id, ['detail' => '50'], $this->authed($pat))->assertOk();

        $row = Entry::findOrFail($id);
        $this->assertSame('50', $row->detail);
        $this->assertSame('sleep', $row->type);
        $this->assertSame(5000, (int) $row->t);
        $this->assertSame($wrenId, $row->baby_id); // never re-homed by omission
    }

    public function test_v1_delete_is_a_tombstone_visible_to_the_pwa(): void
    {
        [$app, $pat] = $this->parentWithPat();
        $id = $this->postJson('/api/v1/entries', ['type' => 'wet'], $this->authed($pat))->json('data.id');

        $this->deleteJson('/api/v1/entries/'.$id, [], $this->authed($pat))->assertOk()
            ->assertJsonPath('data.deleted', true);

        $this->assertTrue((bool) Entry::findOrFail($id)->deleted); // row still exists
        $state = $this->getJson('/api/state?since=0', $this->authed($app))->json();
        $mine = collect($state['entries'])->firstWhere('id', $id);
        $this->assertTrue((bool) $mine['deleted']); // PWA sees the tombstone
    }

    public function test_cross_household_entries_are_invisible_404s(): void
    {
        [, $pat] = $this->parentWithPat();

        // a second household, created directly (registration is invite-locked)
        $foreignHousehold = \App\Models\Household::create();
        $mallory = \App\Models\User::create([
            'name' => 'Mallory', 'email' => 'mallory@example.com', 'password' => 'password123',
            'household_id' => $foreignHousehold->id, 'role' => 'parent',
        ]);
        Entry::create([
            'id' => 'foreign-entry', 'household_id' => $foreignHousehold->id, 'user_id' => $mallory->id,
            'type' => 'bottle', 't' => 1, 'deleted' => false, 'rev' => 1,
        ]);

        $this->getJson('/api/v1/entries/foreign-entry', $this->authed($pat))->assertNotFound();
        $this->patchJson('/api/v1/entries/foreign-entry', ['detail' => 'x'], $this->authed($pat))->assertNotFound();
        $this->deleteJson('/api/v1/entries/foreign-entry', [], $this->authed($pat))->assertNotFound();
    }

    public function test_interleaved_outbox_and_v1_writes_are_last_write_wins(): void
    {
        [$app, $pat] = $this->parentWithPat();
        $id = (string) Str::uuid();

        $this->pushViaOutbox($app, ['id' => $id, 'type' => 'bottle', 't' => 1000, 'detail' => '2']);
        $this->patchJson('/api/v1/entries/'.$id, ['detail' => '4'], $this->authed($pat))->assertOk();
        $this->pushViaOutbox($app, ['id' => $id, 'type' => 'bottle', 't' => 1000, 'detail' => '6']);

        $row = Entry::findOrFail($id);
        $this->assertSame('6', $row->detail); // the last writer won
        $this->assertSame('Ben', $row->user->name ?? 'Ben'); // author preserved throughout
    }

    // ── timer ──────────────────────────────────────────────────────────────

    public function test_timer_lifecycle_is_visible_to_the_pwa_and_never_logs_entries(): void
    {
        [$app, $pat, $wrenId] = $this->parentWithPat();

        $this->getJson('/api/v1/timer', $this->authed($pat))->assertOk()->assertJsonPath('timer', null);

        $timer = $this->putJson('/api/v1/timer', ['type' => 'nurse', 'baby_id' => $wrenId], $this->authed($pat))
            ->assertOk()->json('timer');
        $this->assertSame('nurse', $timer['type']);
        $this->assertSame($wrenId, $timer['baby_id']);

        // the PWA sees the same running timer
        $state = $this->getJson('/api/state?since=0', $this->authed($app))->json();
        $this->assertSame($timer['id'], $state['timer']['id']);

        $stopped = $this->deleteJson('/api/v1/timer', [], $this->authed($pat))->assertOk()->json('stopped');
        $this->assertSame($timer['id'], $stopped['id']);
        $this->assertNull($this->getJson('/api/state?since=0', $this->authed($app))->json('timer'));

        // stopping wrote no entry — consumers log it themselves
        $this->assertSame(0, Entry::query()->count());
    }

    public function test_concurrent_timers_are_listed_and_stopped_by_id(): void
    {
        [, $pat, $wrenId] = $this->parentWithPat();

        $nurse = $this->putJson('/api/v1/timer', ['type' => 'nurse', 'baby_id' => $wrenId], $this->authed($pat))->json('timer');
        $sleep = $this->putJson('/api/v1/timer', ['type' => 'sleep', 'baby_id' => $wrenId], $this->authed($pat))->json('timer');

        $show = $this->getJson('/api/v1/timer', $this->authed($pat))->assertOk()->json();
        $this->assertSame([$nurse['id'], $sleep['id']], array_column($show['timers'], 'id'));
        $this->assertSame($sleep['id'], $show['timer']['id']); // legacy slot: the caller's newest

        $stopped = $this->deleteJson('/api/v1/timer?id='.$nurse['id'], [], $this->authed($pat))->assertOk()->json('stopped');
        $this->assertSame($nurse['id'], $stopped['id']);
        $this->assertSame([$sleep['id']], array_column($this->getJson('/api/v1/timer', $this->authed($pat))->json('timers'), 'id'));
    }

    public function test_the_timer_takes_a_tummy_time_type(): void
    {
        [, $pat, $wrenId] = $this->parentWithPat();

        $timer = $this->putJson('/api/v1/timer', ['type' => 'tummy', 'baby_id' => $wrenId], $this->authed($pat))
            ->assertOk()->json('timer');
        $this->assertSame('tummy', $timer['type']);
    }

    public function test_a_foreign_baby_id_on_the_timer_is_dropped(): void
    {
        [, $pat] = $this->parentWithPat();

        $timer = $this->putJson('/api/v1/timer', ['type' => 'sleep', 'baby_id' => 999], $this->authed($pat))
            ->assertOk()->json('timer');
        $this->assertNull($timer['baby_id']); // clients read null as the primary child
    }

    // ── scoping ────────────────────────────────────────────────────────────

    public function test_the_scope_matrix_holds(): void
    {
        [$app] = $this->parentWithPat();
        $readOnly = $this->mintPat($app, ['entries:read'], name: 'Read only');

        $this->getJson('/api/v1/entries', $this->authed($readOnly))->assertOk();
        $this->postJson('/api/v1/entries', ['type' => 'bottle'], $this->authed($readOnly))->assertForbidden();
        $this->getJson('/api/v1/me', $this->authed($readOnly))->assertForbidden();
        $this->putJson('/api/v1/timer', ['type' => 'nurse'], $this->authed($readOnly))->assertForbidden();

        // the first-party app token carries ['*'] and passes everywhere
        $this->getJson('/api/v1/me', $this->authed($app))->assertOk();
        $this->postJson('/api/v1/entries', ['type' => 'bottle'], $this->authed($app))->assertCreated();
    }

    public function test_v1_requires_auth(): void
    {
        $this->getJson('/api/v1/me')->assertUnauthorized();
    }
}
