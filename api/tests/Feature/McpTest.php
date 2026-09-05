<?php

namespace Tests\Feature;

use App\Mcp\Servers\BabylogServer;
use App\Mcp\Tools\DeleteEntry;
use App\Mcp\Tools\GetDailySummary;
use App\Mcp\Tools\GetHouseholdStatus;
use App\Mcp\Tools\ListChildren;
use App\Mcp\Tools\ListEntries;
use App\Mcp\Tools\LogEntry;
use App\Mcp\Tools\StartTimer;
use App\Mcp\Tools\StopTimer;
use App\Mcp\Tools\UpdateEntry;
use App\Models\Entry;
use App\Models\Household;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\Support\BabylogTestHelpers;
use Tests\TestCase;

/**
 * The MCP server at /mcp. Everything writes through EntryWriter/TimerService,
 * so the assertions mirror ApiV1Test's sync-parity shape: whatever a tool
 * does must be indistinguishable from a PWA write in /api/state.
 */
class McpTest extends TestCase
{
    use BabylogTestHelpers;
    use RefreshDatabase;

    private function household(): array
    {
        $app = $this->register('Ben', 'ben@example.com')->json('token');
        $this->postJson('/api/baby', ['name' => 'Maddux', 'birthdate' => '2026-07-20'], $this->authed($app))->assertOk();
        $wrenId = $this->postJson('/api/children', ['name' => 'Wren'], $this->authed($app))->json('child.id');

        return [User::where('email', 'ben@example.com')->first(), $app, $wrenId];
    }

    // ── transport / auth ───────────────────────────────────────────────────

    public function test_the_endpoint_requires_auth_and_the_mcp_scope(): void
    {
        $this->postJson('/mcp', ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/list'])
            ->assertUnauthorized();

        [, $app] = $this->household();
        $noMcp = $this->mintPat($app, ['entries:read'], name: 'No MCP');
        $this->postJson('/mcp', ['jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/list'], $this->authed($noMcp))
            ->assertForbidden();
    }

    public function test_tools_list_works_end_to_end_over_http(): void
    {
        [, $app] = $this->household();
        $pat = $this->mintPat($app, ['mcp', 'entries:read'], name: 'MCP');

        $response = $this->postJson('/mcp', [
            'jsonrpc' => '2.0', 'id' => 1, 'method' => 'tools/list',
        ], $this->authed($pat))->assertOk();

        $names = collect($response->json('result.tools'))->pluck('name');
        $this->assertContains('list-entries', $names->all());
        $this->assertContains('log-entry', $names->all());
        // structural caregiver safety: no household-management tool names
        foreach (['invite', 'member', 'settings', 'child'] as $forbidden) {
            $this->assertFalse(
                $names->contains(fn ($n) => str_contains($n, $forbidden) && ! str_contains($n, 'children')),
                "Tool list unexpectedly exposes a household-management tool matching '{$forbidden}'",
            );
        }
    }

    // ── read tools ─────────────────────────────────────────────────────────

    public function test_list_children_and_entries_are_household_scoped(): void
    {
        [$ben, $app, $wrenId] = $this->household();
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'e1', 'type' => 'bottle', 't' => 1000, 'detail' => '4'],
            ['id' => 'e2', 'type' => 'sleep', 't' => 2000, 'baby_id' => $wrenId],
            ['id' => 'gone', 'type' => 'wet', 't' => 3000, 'deleted' => true],
        ]], $this->authed($app))->assertOk();

        // a second household that must stay invisible
        $foreign = Household::create();
        $mallory = User::create(['name' => 'Mallory', 'email' => 'm@example.com', 'password' => 'x',
            'household_id' => $foreign->id, 'role' => 'parent']);
        Entry::create(['id' => 'foreign', 'household_id' => $foreign->id, 'user_id' => $mallory->id,
            'type' => 'bottle', 't' => 500, 'deleted' => false, 'rev' => 1]);

        Sanctum::actingAs($ben, ['mcp', 'children:read', 'entries:read']);

        $children = BabylogServer::tool(ListChildren::class)->assertOk();
        $children->assertSee('Maddux')->assertSee('Wren');

        $entries = BabylogServer::tool(ListEntries::class)->assertOk();
        $entries->assertSee('e1')->assertSee('e2')
            ->assertDontSee('gone')      // tombstones excluded
            ->assertDontSee('foreign');  // other household invisible

        $filtered = BabylogServer::tool(ListEntries::class, ['types' => ['bottle']])->assertOk();
        $filtered->assertSee('e1')->assertDontSee('e2');

        BabylogServer::tool(ListEntries::class, ['baby_id' => 99999])->assertHasErrors();
    }

    public function test_daily_summary_totals_by_type(): void
    {
        [$ben, $app] = $this->household();
        $t = now('UTC')->startOfDay()->addHours(6)->getTimestampMs();
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'b1', 'type' => 'bottle', 't' => $t, 'detail' => '4'],
            ['id' => 'b2', 'type' => 'bottle', 't' => $t + 1, 'detail' => '3.5'],
            ['id' => 'n1', 'type' => 'nurse', 't' => $t + 2, 'detail' => 'L'],
            ['id' => 'w1', 'type' => 'wet', 't' => $t + 3],
            ['id' => 's1', 'type' => 'sleep', 't' => $t + 4, 'detail' => '45'],
            ['id' => 's2', 'type' => 'sleep', 't' => $t + 5, 'detail' => 'Nap · 95m'], // tagged sleep still counts its minutes
            ['id' => 'tt1', 'type' => 'tummy', 't' => $t + 6, 'detail' => '12'],
        ]], $this->authed($app))->assertOk();

        Sanctum::actingAs($ben, ['mcp', 'entries:read']);

        BabylogServer::tool(GetDailySummary::class, ['tz' => 'UTC'])->assertOk()
            ->assertSee('"bottles":2')
            ->assertSee('"bottle_oz":7.5')
            ->assertSee('"nursing_sessions":1')
            ->assertSee('"wet":1')
            ->assertSee('"sleep":{"sessions":2,"minutes":140}')
            ->assertSee('"tummy_time":{"sessions":1,"minutes":12}');
    }

    // ── write tools + sync parity ──────────────────────────────────────────

    public function test_log_entry_writes_through_the_shared_path(): void
    {
        [$ben, $app, $wrenId] = $this->household();
        Sanctum::actingAs($ben, ['mcp', 'entries:write']);

        BabylogServer::tool(LogEntry::class, [
            'type' => 'bottle', 'detail' => '4', 'baby_id' => $wrenId,
        ])->assertOk();

        $row = Entry::query()->firstOrFail();
        $this->assertTrue(\Illuminate\Support\Str::isUuid($row->id)); // tool generated the client UUID
        $this->assertSame($ben->id, $row->user_id);
        $this->assertSame($wrenId, $row->baby_id);
        $this->assertGreaterThan(0, $row->rev);

        // visible to the PWA exactly like an outbox write
        $state = $this->getJson('/api/state?since=0', $this->authed($app))->json();
        $this->assertSame($row->id, $state['entries'][0]['id']);

        // foreign baby_id is refused loudly (not silently dropped — tools talk)
        BabylogServer::tool(LogEntry::class, ['type' => 'wet', 'baby_id' => 99999])->assertHasErrors();
    }

    public function test_update_preserves_author_and_delete_is_a_tombstone(): void
    {
        [$ben, $app] = $this->household();
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'mine', 'type' => 'sleep', 't' => 5000, 'detail' => '30'],
        ]], $this->authed($app))->assertOk();

        Sanctum::actingAs($ben, ['mcp', 'entries:write']);

        BabylogServer::tool(UpdateEntry::class, ['id' => 'mine', 'detail' => '40'])->assertOk();
        $row = Entry::findOrFail('mine');
        $this->assertSame('40', $row->detail);
        $this->assertSame('sleep', $row->type);       // untouched fields preserved
        $this->assertSame($ben->id, $row->user_id);   // author preserved

        BabylogServer::tool(DeleteEntry::class, ['id' => 'mine'])->assertOk();
        $this->assertTrue((bool) Entry::findOrFail('mine')->deleted); // tombstone, row kept

        BabylogServer::tool(UpdateEntry::class, ['id' => 'nope', 'detail' => 'x'])->assertHasErrors();
    }

    public function test_timer_stop_logs_the_entry_like_the_pwa_would(): void
    {
        [$ben, $app, $wrenId] = $this->household();
        Sanctum::actingAs($ben, ['mcp', 'timer:write', 'entries:write']);

        BabylogServer::tool(StartTimer::class, ['type' => 'sleep', 'baby_id' => $wrenId])->assertOk();
        $this->assertSame('sleep', $ben->household->fresh()->runningTimers()[0]['type']);

        BabylogServer::tool(StopTimer::class)->assertOk();
        $this->assertSame([], $ben->household->fresh()->runningTimers());

        $row = Entry::query()->firstOrFail();
        $this->assertSame('sleep', $row->type);
        $this->assertSame($wrenId, $row->baby_id);
        $this->assertIsNumeric($row->detail); // elapsed minutes

        // and stop with log=false leaves the log alone
        BabylogServer::tool(StartTimer::class, ['type' => 'pump'])->assertOk();
        BabylogServer::tool(StopTimer::class, ['log' => false])->assertOk();
        $this->assertSame(1, Entry::query()->count());

        // tummy time logs elapsed minutes exactly like sleep
        BabylogServer::tool(StartTimer::class, ['type' => 'tummy', 'baby_id' => $wrenId])->assertOk();
        BabylogServer::tool(StopTimer::class)->assertOk();
        $tummy = Entry::query()->where('type', 'tummy')->firstOrFail();
        $this->assertIsNumeric($tummy->detail);
    }

    public function test_concurrent_timers_stop_by_id(): void
    {
        [$ben, , $wrenId] = $this->household();
        Sanctum::actingAs($ben, ['mcp', 'timer:read', 'timer:write']);

        BabylogServer::tool(StartTimer::class, ['type' => 'nurse', 'baby_id' => $wrenId])->assertOk();
        BabylogServer::tool(StartTimer::class, ['type' => 'sleep', 'baby_id' => $wrenId])->assertOk();
        $timers = $ben->household->fresh()->runningTimers();
        $this->assertCount(2, $timers);

        BabylogServer::tool(StopTimer::class, ['timer_id' => $timers[0]['id'], 'log' => false])->assertOk();
        $this->assertSame([$timers[1]['id']], array_column($ben->household->fresh()->runningTimers(), 'id'));
    }

    // ── scope sweep ────────────────────────────────────────────────────────

    public function test_a_read_only_token_gets_clean_errors_from_every_write_tool(): void
    {
        [$ben] = $this->household();
        Sanctum::actingAs($ben, ['mcp', 'entries:read', 'children:read', 'profile:read', 'timer:read']);

        BabylogServer::tool(ListEntries::class)->assertOk();
        BabylogServer::tool(GetHouseholdStatus::class)->assertOk();

        BabylogServer::tool(LogEntry::class, ['type' => 'wet'])->assertHasErrors();
        BabylogServer::tool(UpdateEntry::class, ['id' => 'x'])->assertHasErrors();
        BabylogServer::tool(DeleteEntry::class, ['id' => 'x'])->assertHasErrors();
        BabylogServer::tool(StartTimer::class, ['type' => 'nurse'])->assertHasErrors();
        $this->assertSame(0, Entry::query()->count());
    }

    public function test_every_tool_is_caregiver_legal(): void
    {
        [, , $doula] = $this->threeMemberHousehold();
        $caregiver = User::where('email', 'doula@example.com')->first();
        Sanctum::actingAs($caregiver, ['*']);

        BabylogServer::tool(ListChildren::class)->assertOk();
        BabylogServer::tool(LogEntry::class, ['type' => 'wet'])->assertOk();
        BabylogServer::tool(StartTimer::class, ['type' => 'nurse'])->assertOk();
        BabylogServer::tool(StopTimer::class, ['log' => false])->assertOk();
    }
}
