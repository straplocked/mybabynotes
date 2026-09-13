<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace Tests\Feature;

use App\Contracts\AccountProvisioner;
use App\Mail\PartnerInvite;
use App\Mail\PasswordResetLink;
use App\Models\Household;
use App\Models\Invite;
use App\Models\Shift;
use App\Models\User;
use App\Services\PushService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

class BabylogApiTest extends TestCase
{
    use RefreshDatabase;

    private function register(string $name, string $email, string $password = 'password123')
    {
        return $this->postJson('/api/register', ['name' => $name, 'email' => $email, 'password' => $password]);
    }

    private function authed(string $token): array
    {
        // guards cache the resolved user across requests within one test —
        // reset so each request authenticates as its own token's user
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$token];
    }

    // ── registration lockdown ─────────────────────────────────────────────────

    public function test_first_account_can_register(): void
    {
        $this->register('Ben', 'ben@example.com')->assertCreated()->assertJsonStructure(['token']);
    }

    public function test_second_uninvited_registration_is_blocked(): void
    {
        $this->register('Ben', 'ben@example.com')->assertCreated();
        $this->register('Mallory', 'mallory@example.com')->assertStatus(422);
        $this->assertSame(1, User::count());
    }

    public function test_account_provisioner_is_swappable_via_config(): void
    {
        // a hosted-style policy: every uninvited signup gets its own household
        config(['babylog.account_provisioner' => FreshHouseholdProvisioner::class]);

        $this->register('Ben', 'ben@example.com')->assertCreated();
        $this->register('Ada', 'ada@example.com')->assertCreated();

        $this->assertNotSame(
            User::where('email', 'ben@example.com')->firstOrFail()->household_id,
            User::where('email', 'ada@example.com')->firstOrFail()->household_id,
        );
    }

    public function test_invited_email_joins_the_household_with_code(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'Katrina@Example.com'], $this->authed($ben))
            ->assertOk()->json('code');
        $this->assertNotEmpty($code);

        // invited email without (or with a wrong) code is rejected — no hijack
        $this->register('Katrina', 'katrina@example.com')->assertStatus(422);
        $this->postJson('/api/register', ['name' => 'Mallory', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => 'WRONG1'])->assertStatus(422);

        $res = $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code]);
        $res->assertCreated();
        $this->assertTrue($res->json('joinedPartner'));
        $this->assertSame(User::first()->household_id, User::orderByDesc('id')->first()->household_id);
    }

    public function test_full_household_cannot_invite_a_third(): void
    {
        config(['babylog.max_household_users' => 2]);
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code])->assertCreated();

        $this->postJson('/api/invite', ['email' => 'third@example.com'], $this->authed($ben))->assertStatus(422);
    }

    public function test_pending_invites_count_against_the_cap(): void
    {
        config(['babylog.max_household_users' => 2]);
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->assertOk();

        // one member + one outstanding invite = both seats spoken for
        $this->postJson('/api/invite', ['email' => 'third@example.com'], $this->authed($ben))->assertStatus(422);

        // re-inviting the same email just regenerates the code — no extra seat
        $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->assertOk();
        $this->assertSame(1, Invite::count());
    }

    public function test_registration_rechecks_capacity_when_the_log_filled_after_the_invite(): void
    {
        config(['babylog.max_household_users' => 3]);
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $codeKat = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $codeDoula = $this->postJson('/api/invite', ['email' => 'doula@example.com'], $this->authed($ben))->json('code');
        $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $codeKat])->assertCreated();

        // the log shrank (self-hoster lowered the cap) after the invite went out
        config(['babylog.max_household_users' => 2]);
        $this->postJson('/api/register', ['name' => 'Doula', 'email' => 'doula@example.com', 'password' => 'password123', 'invite' => $codeDoula])
            ->assertStatus(422);
        $this->assertSame(2, User::count());
    }

    public function test_a_third_member_joins_via_invite_and_appears_in_the_household(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $codeKat = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $codeKat])->assertCreated();

        $codeDoula = $this->postJson('/api/invite', ['email' => 'doula@example.com'], $this->authed($ben))->json('code');
        $doula = $this->postJson('/api/register', ['name' => 'Robin', 'email' => 'doula@example.com', 'password' => 'password123', 'invite' => $codeDoula])
            ->assertCreated()->json('token');

        // all three share one household, and the newcomer converges on its state
        $this->assertSame(3, User::count());
        $this->assertSame(1, User::distinct()->count('household_id'));
        $this->assertSame('Ben', $this->getJson('/api/state', $this->authed($doula))->json('partner.name'));
    }

    public function test_two_concurrent_invites_to_different_emails_both_work(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $codeKat = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $codeDoula = $this->postJson('/api/invite', ['email' => 'doula@example.com'], $this->authed($ben))->json('code');

        // both seats are pending at once; old clients still see the first one
        $this->assertSame(2, Invite::count());
        $this->assertSame('katrina@example.com', $this->getJson('/api/state', $this->authed($ben))->json('invitePending'));

        $this->postJson('/api/register', ['name' => 'Robin', 'email' => 'doula@example.com', 'password' => 'password123', 'invite' => $codeDoula])->assertCreated();
        $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $codeKat])->assertCreated();
        $this->assertSame(3, User::count());
        $this->assertSame(0, Invite::count());
    }

    public function test_invite_code_is_single_use(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code])->assertCreated();

        // the seat is taken: the invite row is gone, and the burned code opens no doors
        $this->assertSame(0, Invite::count());
        $this->postJson('/api/register', ['name' => 'Mallory', 'email' => 'mallory@example.com', 'password' => 'password123', 'invite' => $code])->assertStatus(422);
        $this->assertSame(2, User::count());
    }

    public function test_an_invite_can_carry_the_caregiver_role(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'doula@example.com', 'role' => 'caregiver'], $this->authed($ben))->json('code');
        $this->postJson('/api/register', ['name' => 'Robin', 'email' => 'doula@example.com', 'password' => 'password123', 'invite' => $code])->assertCreated();

        $this->assertSame('caregiver', User::where('email', 'doula@example.com')->sole()->role);
        $this->assertSame('parent', User::where('email', 'ben@example.com')->sole()->role);
    }

    public function test_invite_rejects_an_unknown_role(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $this->postJson('/api/invite', ['email' => 'doula@example.com', 'role' => 'admin'], $this->authed($ben))->assertStatus(422);
    }

    public function test_a_caregiver_cannot_invite(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'doula@example.com', 'role' => 'caregiver'], $this->authed($ben))->json('code');
        $doula = $this->postJson('/api/register', ['name' => 'Robin', 'email' => 'doula@example.com', 'password' => 'password123', 'invite' => $code])->json('token');

        $this->postJson('/api/invite', ['email' => 'friend@example.com'], $this->authed($doula))->assertStatus(403);
        $this->assertSame(0, Invite::count());
    }

    public function test_short_passwords_are_rejected(): void
    {
        $this->register('Ben', 'ben@example.com', 'short')->assertStatus(422);
    }

    public function test_login_rejects_wrong_password(): void
    {
        $this->register('Ben', 'ben@example.com');
        $this->postJson('/api/login', ['email' => 'ben@example.com', 'password' => 'wrong-password'])->assertStatus(422);
        $this->postJson('/api/login', ['email' => 'ben@example.com', 'password' => 'password123'])->assertOk();
    }

    public function test_tokens_expire_after_ninety_idle_days(): void
    {
        // the 90-day window slides with use (TokenExpiryTest has the aging
        // matrix): using a token near the end of its window renews it
        $this->register('Ben', 'ben@example.com');
        $old = $this->postJson('/api/login', ['email' => 'ben@example.com', 'password' => 'password123'])->json('token');

        // day 89: still inside the window — and this use restarts it
        $this->travel(89)->days();
        $this->getJson('/api/state?since=0', $this->authed($old))->assertOk();

        // day 91: alive, because it was last used two days ago
        $this->travel(2)->days();
        $this->getJson('/api/state?since=0', $this->authed($old))->assertOk();

        // 91 more idle days: dead — a fresh login works
        $this->travel(91)->days();
        $this->getJson('/api/state?since=0', $this->authed($old))->assertUnauthorized();
        $fresh = $this->postJson('/api/login', ['email' => 'ben@example.com', 'password' => 'password123'])->json('token');
        $this->getJson('/api/state?since=0', $this->authed($fresh))->assertOk();
    }

    public function test_prune_expired_reaps_stale_token_rows_but_keeps_live_ones(): void
    {
        $this->register('Ben', 'ben@example.com'); // token row from day 0

        // day 98: past 90-day expiry plus the 168h retention window
        $this->travel(98)->days();
        $live = $this->postJson('/api/login', ['email' => 'ben@example.com', 'password' => 'password123'])->json('token');
        $this->assertSame(2, PersonalAccessToken::count());

        $this->artisan('sanctum:prune-expired', ['--hours' => 168])->assertSuccessful();

        $this->assertSame(1, PersonalAccessToken::count());
        $this->getJson('/api/state?since=0', $this->authed($live))->assertOk();
    }

    // ── household scoping ─────────────────────────────────────────────────────

    public function test_entries_are_scoped_to_the_household(): void
    {
        config(['babylog.open_registration' => true]);
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $eve = $this->register('Eve', 'eve@example.com')->json('token');

        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'e1', 'type' => 'bottle', 't' => 1000, 'detail' => '4'],
        ]], $this->authed($ben))->assertOk();

        $this->assertCount(0, $this->getJson('/api/state?since=0', $this->authed($eve))->json('entries'));
        $this->assertCount(1, $this->getJson('/api/state?since=0', $this->authed($ben))->json('entries'));

        // Eve cannot hijack Ben's entry id into her household
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'e1', 'type' => 'meds', 't' => 2000],
        ]], $this->authed($eve))->assertOk();
        $entry = $this->getJson('/api/state?since=0', $this->authed($ben))->json('entries.0');
        $this->assertSame('bottle', $entry['type']);
    }

    public function test_deletes_sync_as_tombstones(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'e1', 'type' => 'bottle', 't' => 1000, 'detail' => '4'],
        ]], $this->authed($ben));
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'e1', 'type' => 'bottle', 't' => 1000, 'detail' => '4', 'deleted' => true],
        ]], $this->authed($ben));

        $entries = $this->getJson('/api/state?since=0', $this->authed($ben))->json('entries');
        $this->assertCount(1, $entries);
        $this->assertTrue((bool) $entries[0]['deleted']);
    }

    public function test_undo_restores_a_deleted_entry_over_its_tombstone(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');

        // logged, then deleted — the tombstone reaches the server first
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'e1', 'type' => 'bottle', 't' => 1000, 'detail' => '4'],
        ]], $this->authed($ben))->assertOk();
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'e1', 'type' => 'bottle', 't' => 1000, 'detail' => '4', 'deleted' => true],
        ]], $this->authed($ben))->assertOk();
        $tombRev = $this->getJson('/api/state?since=0', $this->authed($ben))->json('entries.0.rev');
        $this->assertNotNull($tombRev);

        // Undo pushes the same id restored, after the tombstone — the newer write must win
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'e1', 'type' => 'bottle', 't' => 1000, 'detail' => '4', 'deleted' => false],
        ]], $this->authed($ben))->assertOk();

        $entries = $this->getJson('/api/state?since=0', $this->authed($ben))->json('entries');
        $this->assertCount(1, $entries);
        $this->assertFalse((bool) $entries[0]['deleted']);
        $this->assertSame('bottle', $entries[0]['type']);
        $this->assertSame('4', $entries[0]['detail']);

        // the restore must carry a strictly newer revision than its tombstone, so a
        // partner who already pulled the delete (?since=<tombstone rev>) converges live
        $this->assertGreaterThan($tombRev, $entries[0]['rev']);
        $since = $this->getJson('/api/state?since='.$tombRev, $this->authed($ben))->json('entries');
        $this->assertCount(1, $since);
        $this->assertFalse((bool) $since[0]['deleted']);
    }

    // ── baby ──────────────────────────────────────────────────────────────────

    public function test_baby_birthdate_round_trips_and_survives_omission(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');

        $this->postJson('/api/baby', ['name' => 'Maddux', 'birthdate' => '2026-07-20'], $this->authed($ben))->assertOk();
        $baby = $this->getJson('/api/state', $this->authed($ben))->json('baby');
        $this->assertSame('2026-07-20', $baby['birthdate']);

        // a rename without a birthdate key must not erase the stored DOB
        $this->postJson('/api/baby', ['name' => 'Maddux Jr'], $this->authed($ben))->assertOk();
        $baby = $this->getJson('/api/state', $this->authed($ben))->json('baby');
        $this->assertSame('Maddux Jr', $baby['name']);
        $this->assertSame('2026-07-20', $baby['birthdate']);

        // future and garbage dates are rejected
        $this->postJson('/api/baby', ['name' => 'Maddux', 'birthdate' => now()->addDay()->format('Y-m-d')], $this->authed($ben))->assertStatus(422);
        $this->postJson('/api/baby', ['name' => 'Maddux', 'birthdate' => 'not-a-date'], $this->authed($ben))->assertStatus(422);
    }

    // ── household settings ────────────────────────────────────────────────────

    public function test_settings_sync_to_the_partner(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $kat = $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code])->json('token');

        $this->assertNull($this->getJson('/api/state', $this->authed($ben))->json('settings'));

        $this->postJson('/api/settings', ['tracking' => ['diapers' => false], 'dismissed' => ['meds']], $this->authed($ben))->assertOk();

        $settings = $this->getJson('/api/state', $this->authed($kat))->json('settings');
        $this->assertFalse($settings['tracking']['diapers']);
        $this->assertSame(['meds'], $settings['dismissed']);
    }

    public function test_settings_accept_a_null_widgets_echo(): void
    {
        // clients that never customized the Now-screen cards echo widgets back as
        // null — that must not 422 the whole settings save (e.g. a unit change)
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $this->postJson('/api/settings', ['widgets' => null, 'unit' => 'ml'], $this->authed($ben))->assertOk();

        $settings = $this->getJson('/api/state', $this->authed($ben))->json('settings');
        $this->assertSame('ml', $settings['unit']);
        $this->assertArrayNotHasKey('widgets', $settings);
    }

    public function test_settings_drop_unknown_tracker_keys(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $this->postJson('/api/settings', ['tracking' => ['diapers' => false, 'feeds' => false], 'dismissed' => ['nonsense']], $this->authed($ben))->assertOk();

        $settings = $this->getJson('/api/state', $this->authed($ben))->json('settings');
        $this->assertSame(['diapers' => false], $settings['tracking']);
        $this->assertSame([], $settings['dismissed']);
    }

    public function test_the_tummy_time_tracker_toggle_persists(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $this->postJson('/api/settings', ['tracking' => ['tummy' => false], 'widgets' => ['feeds', 'tummy']], $this->authed($ben))->assertOk();

        $settings = $this->getJson('/api/state', $this->authed($ben))->json('settings');
        $this->assertSame(['tummy' => false], $settings['tracking']);
        $this->assertSame(['feeds', 'tummy'], $settings['widgets']);
    }

    public function test_now_screen_widgets_round_trip_ordered_and_filtered(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');

        // client order is preserved; unknowns and duplicates are dropped
        $this->postJson('/api/settings', ['widgets' => ['pump', 'feeds', 'nope', 'pump']], $this->authed($ben))->assertOk();

        $settings = $this->getJson('/api/state', $this->authed($ben))->json('settings');
        $this->assertSame(['pump', 'feeds'], $settings['widgets']);
    }

    public function test_history_charts_round_trip_ordered_and_filtered(): void
    {
        // "I don't care about diapers per day but can I have it show naps" —
        // the picked list is the household's, so both parents read the same one
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $kat = $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code])->json('token');

        // client order is preserved; unknowns and duplicates are dropped
        $this->postJson('/api/settings', ['charts' => ['sleep', 'feeds', 'nope', 'sleep']], $this->authed($ben))->assertOk();

        $settings = $this->getJson('/api/state', $this->authed($kat))->json('settings');
        $this->assertSame(['sleep', 'feeds'], $settings['charts']);
    }

    public function test_settings_accept_a_null_charts_echo(): void
    {
        // an installed client that never customized History echoes charts back
        // as null — that must not 422 the settings save it rode along with
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $this->postJson('/api/settings', ['charts' => null, 'unit' => 'ml'], $this->authed($ben))->assertOk();

        $settings = $this->getJson('/api/state', $this->authed($ben))->json('settings');
        $this->assertSame('ml', $settings['unit']);
        $this->assertArrayNotHasKey('charts', $settings);
    }

    public function test_a_caregiver_cannot_choose_the_history_charts(): void
    {
        // /api/settings is in PARENT_ONLY_ENDPOINTS already; this pins that the
        // charts key rides that same door and leaves nothing behind
        [$ben, , $doula] = $this->threeMemberHousehold();
        $this->postJson('/api/settings', ['charts' => ['feeds', 'sleep']], $this->authed($ben))->assertOk();

        $this->postJson('/api/settings', ['charts' => ['meds']], $this->authed($doula))->assertStatus(403);

        $this->assertSame(['feeds', 'sleep'], $this->getJson('/api/state', $this->authed($ben))->json('settings.charts'));
    }

    public function test_theme_round_trips_and_rejects_unknown_presets(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');

        $this->postJson('/api/settings', ['theme' => ['accent' => 'clay', 'bg' => 'mist']], $this->authed($ben))->assertOk();
        $this->assertSame(['accent' => 'clay', 'bg' => 'mist'], $this->getJson('/api/state', $this->authed($ben))->json('settings.theme'));

        // only known preset keys — a free-form hex would bypass the palette
        $this->postJson('/api/settings', ['theme' => ['accent' => '#FF0000']], $this->authed($ben))->assertStatus(422);
        $this->postJson('/api/settings', ['theme' => ['bg' => 'vantablack']], $this->authed($ben))->assertStatus(422);

        // a client that predates themes syncs settings without the key — theme survives
        $this->postJson('/api/settings', ['tracking' => ['bath' => false]], $this->authed($ben))->assertOk();
        $this->assertSame('clay', $this->getJson('/api/state', $this->authed($ben))->json('settings.theme.accent'));
    }

    public function test_unit_setting_round_trips_to_the_partner(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $kat = $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code])->json('token');

        $this->postJson('/api/settings', ['unit' => 'ml'], $this->authed($ben))->assertOk();
        $this->assertSame('ml', $this->getJson('/api/state', $this->authed($kat))->json('settings.unit'));

        // oz and ml only — amounts are stored in oz, so a free-form unit would lie
        $this->postJson('/api/settings', ['unit' => 'litres'], $this->authed($ben))->assertStatus(422);
        $this->postJson('/api/settings', ['unit' => 'ML'], $this->authed($ben))->assertStatus(422);

        // a client that predates units syncs settings without the key — unit survives
        $this->postJson('/api/settings', ['tracking' => ['bath' => false]], $this->authed($kat))->assertOk();
        $this->assertSame('ml', $this->getJson('/api/state', $this->authed($ben))->json('settings.unit'));
    }

    public function test_med_name_round_trips_to_the_partner(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $kat = $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code])->json('token');

        $this->postJson('/api/settings', ['medName' => '  Vitamin D drops  '], $this->authed($ben))->assertOk();
        $this->assertSame('Vitamin D drops', $this->getJson('/api/state', $this->authed($kat))->json('settings.medName'));

        // a client that predates medName syncs settings without the key — the name survives
        $this->postJson('/api/settings', ['tracking' => ['bath' => false]], $this->authed($kat))->assertOk();
        $this->assertSame('Vitamin D drops', $this->getJson('/api/state', $this->authed($ben))->json('settings.medName'));

        // clearing the field is allowed — clients fall back to Vitamin D on read
        $this->postJson('/api/settings', ['medName' => ''], $this->authed($ben))->assertOk();
        $this->assertSame('', $this->getJson('/api/state', $this->authed($ben))->json('settings.medName'));

        // a novel of a med name is rejected
        $this->postJson('/api/settings', ['medName' => str_repeat('a', 41)], $this->authed($ben))->assertStatus(422);
    }

    public function test_settings_are_scoped_to_the_household(): void
    {
        config(['babylog.open_registration' => true]);
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $eve = $this->register('Eve', 'eve@example.com')->json('token');

        $this->postJson('/api/settings', ['tracking' => ['bath' => false]], $this->authed($ben))->assertOk();
        $this->assertNull($this->getJson('/api/state', $this->authed($eve))->json('settings'));
    }

    // ── shifts ────────────────────────────────────────────────────────────────

    public function test_full_shift_cycle_transfers_duty(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $kat = $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code])->json('token');

        $benId = $this->getJson('/api/state', $this->authed($ben))->json('user.id');
        $katId = $this->getJson('/api/state', $this->authed($kat))->json('user.id');

        // Ben (first user) starts on duty and asks Katrina to take over
        $this->assertSame($benId, $this->getJson('/api/state', $this->authed($ben))->json('onDutyUserId'));
        $this->postJson('/api/shifts/request', ['note' => 'need sleep'], $this->authed($ben))->assertOk();
        $this->assertSame('requested', $this->getJson('/api/state', $this->authed($kat))->json('shift.state'));

        $this->postJson('/api/shifts/accept', ['plan' => [], 'until' => 'Open-ended'], $this->authed($kat))->assertOk();
        $this->assertSame($katId, $this->getJson('/api/state', $this->authed($ben))->json('onDutyUserId'));

        $this->postJson('/api/shifts/handback', ['note' => 'went fine'], $this->authed($kat))->assertOk();
        $state = $this->getJson('/api/state', $this->authed($ben))->json();
        $this->assertSame($benId, $state['onDutyUserId']);
        $this->assertSame('completed', $state['shift']['state']);
        $this->assertSame('went fine', $state['shift']['handback_note']);
    }

    public function test_state_requires_auth(): void
    {
        $this->getJson('/api/state')->assertStatus(401);
    }

    public function test_unauthenticated_api_request_without_accept_header_gets_json_401(): void
    {
        // curl/health-check probes send no Accept header; without the api/*
        // shouldRenderJsonWhen rule Laravel would try to redirect to a
        // nonexistent 'login' route and 500 instead
        $this->get('/api/state')->assertStatus(401);
    }

    // ── timers ────────────────────────────────────────────────────────────────

    public function test_timer_start_and_stop_sync_to_the_household(): void
    {
        config(['babylog.open_registration' => true]);
        $ben = $this->register('Ben', 'ben@example.com')->json('token');

        $this->assertNull($this->getJson('/api/state', $this->authed($ben))->json('timer'));

        $timer = $this->postJson('/api/timer/start', ['type' => 'nurse'], $this->authed($ben))->assertOk()->json('timer');
        $this->assertSame('nurse', $timer['type']);
        $this->assertNotEmpty($timer['started_at']);

        $synced = $this->getJson('/api/state', $this->authed($ben))->json('timer');
        $this->assertSame('nurse', $synced['type']);

        $this->postJson('/api/timer/stop', [], $this->authed($ben))->assertOk();
        $this->assertNull($this->getJson('/api/state', $this->authed($ben))->json('timer'));
    }

    public function test_timer_rejects_unknown_type(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $this->postJson('/api/timer/start', ['type' => 'bottle'], $this->authed($ben))->assertStatus(422);
    }

    public function test_sleep_timer_syncs_to_the_partner_and_clears_on_stop(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $kat = $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code])->json('token');

        $timer = $this->postJson('/api/timer/start', ['type' => 'sleep'], $this->authed($ben))->assertOk()->json('timer');
        $this->assertSame('sleep', $timer['type']);

        // the other parent's pull sees the same running timer
        $synced = $this->getJson('/api/state', $this->authed($kat))->json('timer');
        $this->assertSame('sleep', $synced['type']);
        $this->assertSame($timer['id'], $synced['id']);

        $this->postJson('/api/timer/stop', [], $this->authed($ben))->assertOk();
        $this->assertNull($this->getJson('/api/state', $this->authed($kat))->json('timer'));
    }

    public function test_tummy_time_timer_starts_and_stops(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');

        $timer = $this->postJson('/api/timer/start', ['type' => 'tummy'], $this->authed($ben))->assertOk()->json('timer');
        $this->assertSame('tummy', $timer['type']);

        $this->postJson('/api/timer/stop', ['id' => $timer['id']], $this->authed($ben))->assertOk();
        $this->assertSame([], $this->getJson('/api/state', $this->authed($ben))->json('timers'));
    }

    public function test_concurrent_timers_stack_and_stop_individually(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $kat = $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code])->json('token');

        $nurse = $this->postJson('/api/timer/start', ['type' => 'nurse'], $this->authed($ben))->json('timer');
        $sleep = $this->postJson('/api/timer/start', ['type' => 'sleep'], $this->authed($kat))->json('timer');

        // both run side by side; the legacy singular slot is each viewer's own
        $benState = $this->getJson('/api/state', $this->authed($ben))->json();
        $this->assertCount(2, $benState['timers']);
        $this->assertSame($nurse['id'], $benState['timer']['id']);
        $this->assertSame($sleep['id'], $this->getJson('/api/state', $this->authed($kat))->json('timer.id'));

        // an identical re-start (double tap) returns the running timer, no duplicate
        $again = $this->postJson('/api/timer/start', ['type' => 'nurse'], $this->authed($ben))->json('timer');
        $this->assertSame($nurse['id'], $again['id']);
        $this->assertCount(2, $this->getJson('/api/state', $this->authed($ben))->json('timers'));

        // stopping by id takes down only that timer
        $this->postJson('/api/timer/stop', ['id' => $sleep['id']], $this->authed($kat))->assertOk();
        $left = $this->getJson('/api/state', $this->authed($ben))->json('timers');
        $this->assertCount(1, $left);
        $this->assertSame($nurse['id'], $left[0]['id']);
    }

    public function test_the_client_may_supply_the_timer_id(): void
    {
        config(['babylog.open_registration' => true]);
        $ben = $this->register('Ben', 'ben@example.com')->json('token');

        $timer = $this->postJson('/api/timer/start', ['type' => 'pump', 'id' => 'client-made-id'], $this->authed($ben))->json('timer');
        $this->assertSame('client-made-id', $timer['id']);

        $this->postJson('/api/timer/stop', ['id' => 'client-made-id'], $this->authed($ben))->assertOk();
        $this->assertSame([], $this->getJson('/api/state', $this->authed($ben))->json('timers'));
    }

    // ── resuming a sleep ──────────────────────────────────────────────────────
    // A baby who stirs for five minutes had ONE nap with a gap in it. Resume
    // re-opens the logged sleep instead of stacking a second one: the timer
    // comes back backdated to where that entry began and points at it, so
    // whoever stops it rewrites that row.

    public function test_resume_reopens_a_sleep_backdated_to_where_it_started(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        // a 45-minute nap that ended two minutes ago
        $ended = now()->getTimestampMs() - 2 * 60000;
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'nap-1', 'type' => 'sleep', 't' => $ended, 'detail' => '45'],
        ]], $this->authed($ben))->assertOk();

        $timer = $this->postJson('/api/timer/resume', ['entry_id' => 'nap-1'], $this->authed($ben))
            ->assertOk()->json('timer');

        $this->assertSame('sleep', $timer['type']);
        $this->assertSame('nap-1', $timer['resumes']);
        $this->assertSame($ended - 45 * 60000, $timer['started_at']);

        // the partner's pull sees the same re-opened session
        $synced = $this->getJson('/api/state', $this->authed($ben))->json('timers');
        $this->assertCount(1, $synced);
        $this->assertSame('nap-1', $synced[0]['resumes']);
    }

    public function test_resume_reads_the_length_out_of_a_tagged_sleep(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $ended = now()->getTimestampMs();
        // tagged naps spell the duration as a "90m" token, untagged as bare minutes
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'nap-1', 'type' => 'sleep', 't' => $ended, 'detail' => 'Night · 90m'],
        ]], $this->authed($ben))->assertOk();

        $timer = $this->postJson('/api/timer/resume', ['entry_id' => 'nap-1'], $this->authed($ben))
            ->assertOk()->json('timer');
        $this->assertSame($ended - 90 * 60000, $timer['started_at']);
    }

    public function test_resuming_the_same_sleep_twice_returns_the_one_session(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $kat = $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code])->json('token');
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'nap-1', 'type' => 'sleep', 't' => now()->getTimestampMs(), 'detail' => '30'],
        ]], $this->authed($ben))->assertOk();

        $first = $this->postJson('/api/timer/resume', ['entry_id' => 'nap-1'], $this->authed($ben))->json('timer');
        // both phones tapping Resume on the same nap is still one session
        $second = $this->postJson('/api/timer/resume', ['entry_id' => 'nap-1'], $this->authed($kat))->json('timer');

        $this->assertSame($first['id'], $second['id']);
        $this->assertCount(1, $this->getJson('/api/state', $this->authed($kat))->json('timers'));
    }

    public function test_resume_refuses_anything_that_isnt_a_live_sleep_of_ours(): void
    {
        config(['babylog.open_registration' => true]); // a second household to reach across
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'bottle-1', 'type' => 'bottle', 't' => 1000, 'detail' => '4'],
            ['id' => 'nap-gone', 'type' => 'sleep', 't' => 2000, 'detail' => '20', 'deleted' => true],
        ]], $this->authed($ben))->assertOk();

        // a feed has no start to pick up from; a tombstoned nap is gone; and a
        // stranger's id must never reach across households
        $this->postJson('/api/timer/resume', ['entry_id' => 'bottle-1'], $this->authed($ben))->assertStatus(404);
        $this->postJson('/api/timer/resume', ['entry_id' => 'nap-gone'], $this->authed($ben))->assertStatus(404);
        $this->postJson('/api/timer/resume', ['entry_id' => 'never-existed'], $this->authed($ben))->assertStatus(404);
        $this->postJson('/api/timer/resume', [], $this->authed($ben))->assertStatus(422);

        $eve = $this->register('Eve', 'eve@example.com')->json('token');
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'eve-nap', 'type' => 'sleep', 't' => 3000, 'detail' => '15'],
        ]], $this->authed($eve))->assertOk();
        $this->postJson('/api/timer/resume', ['entry_id' => 'eve-nap'], $this->authed($ben))->assertStatus(404);

        $this->assertSame([], $this->getJson('/api/state', $this->authed($ben))->json('timers'));
    }

    public function test_resume_keeps_the_sleeps_own_child(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $this->postJson('/api/children', ['name' => 'Wren'], $this->authed($ben))->assertOk();
        $twin = $this->postJson('/api/children', ['name' => 'Sage'], $this->authed($ben))->assertOk()->json('child.id');
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'nap-1', 'type' => 'sleep', 't' => now()->getTimestampMs(), 'detail' => '40', 'baby_id' => $twin],
        ]], $this->authed($ben))->assertOk();

        $timer = $this->postJson('/api/timer/resume', ['entry_id' => 'nap-1'], $this->authed($ben))->json('timer');
        $this->assertSame($twin, $timer['baby_id']);
    }

    public function test_a_caregiver_may_resume_a_sleep(): void
    {
        [$ben, , $doula] = $this->threeMemberHousehold();
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'nap-1', 'type' => 'sleep', 't' => now()->getTimestampMs(), 'detail' => '25'],
        ]], $this->authed($ben))->assertOk();

        // running timers is the caregiver's actual job — so is picking one back up
        $this->postJson('/api/timer/resume', ['entry_id' => 'nap-1'], $this->authed($doula))->assertOk();
    }

    // ── shift edge cases ─────────────────────────────────────────────────────

    public function test_accept_tolerates_fractional_plan_timestamps(): void
    {
        // the client derives plan times from an averaged feed gap — a float.
        // this used to 422 the whole handoff and the UI swallowed it as "offline"
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $kat = $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code])->json('token');
        $katId = $this->getJson('/api/state', $this->authed($kat))->json('user.id');

        $plan = [['id' => 'p1', 'type' => 'bottle', 'at' => 1788385718169.5], ['id' => 'p2', 'type' => 'bottle', 'at' => 1788396518169.25]];
        $res = $this->postJson('/api/shifts/accept', ['plan' => $plan, 'until' => 'Until 6 AM'], $this->authed($kat))->assertOk();
        $this->assertSame(1788385718170, $res->json('shift.plan.0.at'));
        $this->assertSame($katId, $this->getJson('/api/state', $this->authed($ben))->json('onDutyUserId'));

        // plan replacement is just as forgiving
        $this->postJson('/api/shifts/plan', ['plan' => [['id' => 'p3', 'type' => 'meds', 'at' => 1788400000000.7]]], $this->authed($kat))->assertOk();
        $this->assertSame(1788400000001, $this->getJson('/api/state', $this->authed($kat))->json('shift.plan.0.at'));
    }

    public function test_handback_cancels_a_lingering_request(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $kat = $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code])->json('token');
        $katId = $this->getJson('/api/state', $this->authed($kat))->json('user.id');

        // Ben asks, Katrina never answers, Ben hands duty over directly anyway
        $this->postJson('/api/shifts/request', ['note' => 'take him?'], $this->authed($ben))->assertOk();
        $this->postJson('/api/shifts/handback', [], $this->authed($ben))->assertOk();

        $state = $this->getJson('/api/state', $this->authed($kat))->json();
        $this->assertSame($katId, $state['onDutyUserId']);
        // the stale ask must not survive to render a phantom "Ben is handing off" card
        $this->assertNotSame('requested', $state['shift']['state']);
    }

    /** Container-bound push recorder: no subscriptions or transport needed. */
    private function fakePush(): object
    {
        $fake = new class extends PushService
        {
            public array $sent = [];

            public function notify(User $user, string $tag, string|array $title, string|array $body): void
            {
                // render in English so assertions read like the copy always did
                $this->sent[] = ['user_id' => $user->id, 'tag' => $tag, 'title' => self::render($title, 'en'), 'body' => self::render($body, 'en')];
            }
        };
        $this->app->instance(PushService::class, $fake);

        return $fake;
    }

    public function test_until_ping_notifies_both_parents_exactly_once(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $kat = $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code])->json('token');
        $benId = $this->getJson('/api/state', $this->authed($ben))->json('user.id');
        $katId = $this->getJson('/api/state', $this->authed($kat))->json('user.id');

        // Katrina takes over "until 6 AM" — an until-time already in the past
        $this->postJson('/api/shifts/accept', [
            'plan' => [], 'until' => 'Until 6 AM', 'until_at' => now()->getTimestampMs() - 60000,
        ], $this->authed($kat))->assertOk();

        $fake = $this->fakePush();
        $this->artisan('babylog:reminders')->assertSuccessful();

        // both parents got exactly one ping each: holder asked to hand back,
        // partner told the shift is up (decision locked: ping BOTH)
        $this->assertCount(2, $fake->sent);
        $holderPing = collect($fake->sent)->firstWhere('user_id', $katId);
        $partnerPing = collect($fake->sent)->firstWhere('user_id', $benId);
        $this->assertSame('Shift over — hand back?', $holderPing['title']);
        $this->assertSame('Katrina’s shift is up', $partnerPing['title']);

        // the marker is set, and nothing about the shift state changed by itself
        $this->assertNotNull(Shift::sole()->until_notified_at);
        $state = $this->getJson('/api/state', $this->authed($ben))->json();
        $this->assertSame($katId, $state['onDutyUserId']);
        $this->assertSame('active', $state['shift']['state']);

        // the command runs every minute — a second tick must not ping again
        $this->artisan('babylog:reminders')->assertSuccessful();
        $this->assertCount(2, $fake->sent);
    }

    public function test_until_ping_waits_for_the_until_time(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $kat = $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code])->json('token');

        // an until-time still an hour out, and no ping fires
        $this->postJson('/api/shifts/accept', [
            'plan' => [], 'until' => 'Until 6 AM', 'until_at' => now()->getTimestampMs() + 3600000,
        ], $this->authed($kat))->assertOk();

        $fake = $this->fakePush();
        $this->artisan('babylog:reminders')->assertSuccessful();

        $this->assertCount(0, $fake->sent);
        $this->assertNull(Shift::sole()->until_notified_at);
    }

    // ── account (name / email / password) ─────────────────────────────────────

    public function test_profile_name_change_syncs_to_the_partner(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $kat = $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code])->json('token');

        $this->postJson('/api/account/profile', ['name' => 'Benjamin'], $this->authed($ben))->assertOk();

        $this->assertSame('Benjamin', $this->getJson('/api/state', $this->authed($ben))->json('user.name'));
        $this->assertSame('Benjamin', $this->getJson('/api/state', $this->authed($kat))->json('partner.name'));

        // a blank name is rejected and changes nothing
        $this->postJson('/api/account/profile', ['name' => ''], $this->authed($ben))->assertStatus(422);
        $this->assertSame('Benjamin', $this->getJson('/api/state', $this->authed($ben))->json('user.name'));
    }

    public function test_email_change_requires_the_current_password(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');

        // wrong password → rejected, address untouched
        $this->postJson('/api/account/email', ['email' => 'new@example.com', 'password' => 'wrong-password'], $this->authed($ben))->assertStatus(422);
        $this->assertSame('ben@example.com', $this->getJson('/api/state', $this->authed($ben))->json('user.email'));
        $this->postJson('/api/login', ['email' => 'ben@example.com', 'password' => 'password123'])->assertOk();

        // right password → stored lowercased, and login follows the new address
        $this->postJson('/api/account/email', ['email' => 'New.Ben@Example.com', 'password' => 'password123'], $this->authed($ben))->assertOk();
        $this->assertSame('new.ben@example.com', $this->getJson('/api/state', $this->authed($ben))->json('user.email'));
        $this->postJson('/api/login', ['email' => 'ben@example.com', 'password' => 'password123'])->assertStatus(422);
        $this->postJson('/api/login', ['email' => 'new.ben@example.com', 'password' => 'password123'])->assertOk();
    }

    public function test_email_change_rejects_a_duplicate_email(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code])->assertCreated();

        // the partner's address is taken — case games don't sneak past the check
        $this->postJson('/api/account/email', ['email' => 'Katrina@Example.com', 'password' => 'password123'], $this->authed($ben))->assertStatus(422);
        $this->assertSame('ben@example.com', $this->getJson('/api/state', $this->authed($ben))->json('user.email'));

        // re-saving your own address is not a duplicate
        $this->postJson('/api/account/email', ['email' => 'ben@example.com', 'password' => 'password123'], $this->authed($ben))->assertOk();
    }

    public function test_password_change_requires_current_and_logs_out_other_phones(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $otherPhone = $this->postJson('/api/login', ['email' => 'ben@example.com', 'password' => 'password123'])->json('token');

        // wrong current password → rejected, the old password still works
        $this->postJson('/api/account/password', ['current_password' => 'wrong-password', 'password' => 'newpassword9'], $this->authed($ben))->assertStatus(422);
        $this->postJson('/api/login', ['email' => 'ben@example.com', 'password' => 'password123'])->assertOk();

        // a too-short replacement is rejected too
        $this->postJson('/api/account/password', ['current_password' => 'password123', 'password' => 'short'], $this->authed($ben))->assertStatus(422);
        $this->postJson('/api/login', ['email' => 'ben@example.com', 'password' => 'password123'])->assertOk();

        $this->postJson('/api/account/password', ['current_password' => 'password123', 'password' => 'newpassword9'], $this->authed($ben))->assertOk();

        $this->postJson('/api/login', ['email' => 'ben@example.com', 'password' => 'password123'])->assertStatus(422);
        $this->postJson('/api/login', ['email' => 'ben@example.com', 'password' => 'newpassword9'])->assertOk();

        // the session that changed the password survives; every other one is dead
        $this->getJson('/api/state', $this->authed($ben))->assertOk();
        $this->getJson('/api/state', $this->authed($otherPhone))->assertStatus(401);
    }

    // ── email flows (invite mail + password reset) ────────────────────────────

    public function test_invite_emails_the_partner_when_mail_is_configured(): void
    {
        config(['mail.default' => 'smtp']);
        Mail::fake();

        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $res = $this->postJson('/api/invite', ['email' => 'Katrina@Example.com'], $this->authed($ben))->assertOk();

        $this->assertTrue($res->json('mailed'));
        Mail::assertSent(PartnerInvite::class, fn (PartnerInvite $mail) => $mail->hasTo('katrina@example.com')
            && $mail->code === $res->json('code')
            && $mail->inviterName === 'Ben');
    }

    public function test_invite_stays_silent_without_a_mailer(): void
    {
        config(['mail.default' => 'log']);
        Mail::fake();

        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $res = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->assertOk();

        $this->assertFalse($res->json('mailed'));
        $this->assertNotEmpty($res->json('code')); // the shareable code still works
        Mail::assertNothingSent();
    }

    public function test_forgot_password_reports_when_mail_is_unconfigured(): void
    {
        config(['mail.default' => 'log']);
        $this->register('Ben', 'ben@example.com');

        $this->postJson('/api/forgot-password', ['email' => 'ben@example.com'])
            ->assertOk()
            ->assertJson(['sent' => false, 'reason' => 'mail-unconfigured']);
    }

    public function test_forgot_password_never_reveals_whether_an_account_exists(): void
    {
        config(['mail.default' => 'smtp']);
        Mail::fake();
        $this->register('Ben', 'ben@example.com');

        $this->postJson('/api/forgot-password', ['email' => 'ben@example.com'])->assertOk()->assertJson(['sent' => true]);
        $this->postJson('/api/forgot-password', ['email' => 'stranger@example.com'])->assertOk()->assertJson(['sent' => true]);

        Mail::assertSent(PasswordResetLink::class, 1); // only the real account got mail
    }

    public function test_password_reset_round_trip_changes_the_password(): void
    {
        config(['mail.default' => 'smtp']);
        Mail::fake();
        $this->register('Ben', 'ben@example.com');

        $this->postJson('/api/forgot-password', ['email' => 'ben@example.com'])->assertOk();

        $token = null;
        Mail::assertSent(PasswordResetLink::class, function (PasswordResetLink $mail) use (&$token) {
            $token = $mail->token;

            // the link lands on the SPA, which reads #reset & email on boot
            return str_contains($mail->url, '/#reset='.$mail->token)
                && str_contains($mail->url, 'email=ben%40example.com');
        });
        $this->assertNotNull($token);

        // a garbage token is refused and changes nothing
        $this->postJson('/api/reset-password', ['token' => 'not-the-token', 'email' => 'ben@example.com', 'password' => 'newpassword9'])->assertStatus(422);
        $this->postJson('/api/login', ['email' => 'ben@example.com', 'password' => 'password123'])->assertOk();

        $this->postJson('/api/reset-password', ['token' => $token, 'email' => 'ben@example.com', 'password' => 'newpassword9'])->assertOk();

        $this->postJson('/api/login', ['email' => 'ben@example.com', 'password' => 'password123'])->assertStatus(422);
        $this->postJson('/api/login', ['email' => 'ben@example.com', 'password' => 'newpassword9'])->assertOk();
    }

    public function test_the_reset_link_carries_its_token_in_the_fragment_not_the_query(): void
    {
        // The fragment never leaves the browser, so the token stays out of
        // nginx/proxy access logs and Referer headers. A query string would be
        // logged before any JS could scrub it.
        config(['app.url' => 'https://notes.example.com/']);

        $mail = new PasswordResetLink('Ben', 'ben+kid@example.com', 'tok123');

        $this->assertSame('https://notes.example.com/#reset=tok123&email=ben%2Bkid%40example.com', $mail->url);
        $this->assertStringNotContainsString('?reset=', $mail->url);
        $this->assertStringNotContainsString('?', $mail->url);

        // and the body the user actually receives carries that same link
        $body = $mail->render();
        $this->assertStringContainsString('/#reset=tok123&email=ben%2Bkid%40example.com', $body);
        $this->assertStringNotContainsString('?reset=', $body);
    }

    // ── multi-member households (roles, members, invites) ─────────────────────

    /** Ben (parent) + Katrina (parent) + Robin the doula (caregiver), one household. */
    private function threeMemberHousehold(): array
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $codeKat = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $kat = $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $codeKat])->json('token');
        $codeDoula = $this->postJson('/api/invite', ['email' => 'doula@example.com', 'role' => 'caregiver'], $this->authed($ben))->json('code');
        $doula = $this->postJson('/api/register', ['name' => 'Robin', 'email' => 'doula@example.com', 'password' => 'password123', 'invite' => $codeDoula])->json('token');

        return [$ben, $kat, $doula];
    }

    public function test_state_lists_members_children_and_invites(): void
    {
        [$ben, $kat, $doula] = $this->threeMemberHousehold();
        $this->postJson('/api/baby', ['name' => 'Maddux', 'birthdate' => '2026-07-20'], $this->authed($ben))->assertOk();
        $wrenId = $this->postJson('/api/children', ['name' => 'Wren'], $this->authed($ben))->assertOk()->json('child.id');
        $this->postJson('/api/invite', ['email' => 'granny@example.com', 'role' => 'caregiver'], $this->authed($ben))->assertOk();

        $state = $this->getJson('/api/state', $this->authed($ben))->json();

        // every member, id-ordered, with their role — hand-written expectations
        $this->assertSame(['Ben', 'Katrina', 'Robin'], array_column($state['members'], 'name'));
        $this->assertSame(['parent', 'parent', 'caregiver'], array_column($state['members'], 'role'));
        $this->assertSame('parent', $state['user']['role']);
        $this->assertSame('caregiver', $this->getJson('/api/state', $this->authed($doula))->json('user.role'));

        // all children ride along, primary first
        $this->assertSame(['Maddux', 'Wren'], array_column($state['children'], 'name'));
        $this->assertSame('2026-07-20', $state['children'][0]['birthdate']);
        $this->assertFalse($state['children'][1]['archived']);
        $this->assertSame($wrenId, $state['children'][1]['id']);

        // pending invites carry their role
        $this->assertSame([['email' => 'granny@example.com', 'role' => 'caregiver']], $state['invites']);

        // legacy singular keys survive for installed PWAs: primary child + first other member
        $this->assertSame('Maddux', $state['baby']['name']);
        $this->assertSame('Katrina', $state['partner']['name']);
        $this->assertSame('granny@example.com', $state['invitePending']);
    }

    /**
     * The one list every parent-only endpoint must appear on. A new
     * household-shaping endpoint joins this map or a caregiver can reach it.
     */
    private const PARENT_ONLY_ENDPOINTS = [
        '/api/integrations/mqtt' => ['enabled' => true, 'host' => 'evil.example'],
        '/api/integrations/mqtt/test' => ['host' => 'evil.example'],
        '/api/baby' => ['name' => 'Hijack'],
        '/api/children' => ['name' => 'Hijack'],
        '/api/settings' => ['unit' => 'ml'],
        '/api/invite' => ['email' => 'mole@example.com'],
        '/api/invite/revoke' => ['email' => 'katrina@example.com'],
        '/api/household/remove-member' => ['user_id' => 1],
    ];

    public function test_every_parent_only_endpoint_403s_a_caregiver(): void
    {
        [$ben, , $doula] = $this->threeMemberHousehold();
        $this->postJson('/api/baby', ['name' => 'Maddux'], $this->authed($ben))->assertOk();

        foreach (self::PARENT_ONLY_ENDPOINTS as $path => $payload) {
            $this->assertSame(
                403,
                $this->postJson($path, $payload, $this->authed($doula))->getStatusCode(),
                $path.' let a caregiver through',
            );
        }

        // and none of the attempts left a mark
        $state = $this->getJson('/api/state', $this->authed($ben))->json();
        $this->assertSame('Maddux', $state['baby']['name']);
        $this->assertSame(1, count($state['children']));
        $this->assertSame([], $state['invites']);
        $this->assertSame(3, count($state['members']));
        $this->assertNull($state['settings']['unit'] ?? null);
    }

    public function test_a_caregiver_cannot_manage_the_household_but_can_log(): void
    {
        [, , $doula] = $this->threeMemberHousehold();

        $this->postJson('/api/settings', ['unit' => 'ml'], $this->authed($doula))->assertStatus(403);
        $this->postJson('/api/baby', ['name' => 'Hijack'], $this->authed($doula))->assertStatus(403);
        $this->postJson('/api/children', ['name' => 'Hijack'], $this->authed($doula))->assertStatus(403);
        $this->postJson('/api/invite/revoke', ['email' => 'katrina@example.com'], $this->authed($doula))->assertStatus(403);
        $this->postJson('/api/household/remove-member', ['user_id' => 1], $this->authed($doula))->assertStatus(403);

        // their actual job still works: logging entries and running timers
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'd1', 'type' => 'bottle', 't' => 1000, 'detail' => '4'],
        ]], $this->authed($doula))->assertOk();
        $this->postJson('/api/timer/start', ['type' => 'nurse'], $this->authed($doula))->assertOk();
    }

    public function test_removing_a_member_kills_their_session_but_keeps_their_entries(): void
    {
        [$ben, , $doula] = $this->threeMemberHousehold();
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'd1', 'type' => 'bottle', 't' => 1000, 'detail' => '4'],
        ]], $this->authed($doula))->assertOk();
        $doulaId = $this->getJson('/api/state', $this->authed($doula))->json('user.id');
        $benId = $this->getJson('/api/state', $this->authed($ben))->json('user.id');

        // you can't vote yourself off the island
        $this->postJson('/api/household/remove-member', ['user_id' => $benId], $this->authed($ben))->assertStatus(422);

        $this->postJson('/api/household/remove-member', ['user_id' => $doulaId], $this->authed($ben))->assertOk();

        // the removed member's token is dead — the row itself is reaped, not
        // just orphaned — and they're out of the member list
        $this->getJson('/api/state', $this->authed($doula))->assertStatus(401);
        $this->assertSame(0, PersonalAccessToken::where('tokenable_id', $doulaId)->count());
        $state = $this->getJson('/api/state', $this->authed($ben))->json();
        $this->assertSame(['Ben', 'Katrina'], array_column($state['members'], 'name'));

        // but the history still says who logged what
        $this->assertSame($doulaId, $state['entries'][0]['user_id']);
        $this->assertSame(2, User::count());
    }

    public function test_state_reports_the_configured_limits(): void
    {
        config(['babylog.max_household_users' => 3, 'babylog.max_children' => 4]);
        $ben = $this->register('Ben', 'ben@example.com')->json('token');

        $limits = $this->getJson('/api/state', $this->authed($ben))->json('limits');

        // hand-written expectations matching the in-test config, not the defaults
        $this->assertSame(['maxMembers' => 3, 'maxChildren' => 4], $limits);
    }

    public function test_a_removed_member_lands_in_former_members_with_their_name(): void
    {
        [$ben, , $doula] = $this->threeMemberHousehold();
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'd1', 'type' => 'bottle', 't' => 1000, 'detail' => '4'],
        ]], $this->authed($doula))->assertOk();
        $doulaId = $this->getJson('/api/state', $this->authed($doula))->json('user.id');

        $this->postJson('/api/household/remove-member', ['user_id' => $doulaId], $this->authed($ben))->assertOk();

        $state = $this->getJson('/api/state', $this->authed($ben))->json();
        // gone from members, remembered in formerMembers — so their entries
        // can still be attributed by name
        $this->assertSame(['Ben', 'Katrina'], array_column($state['members'], 'name'));
        $this->assertSame([['id' => $doulaId, 'name' => 'Robin']], $state['formerMembers']);
        $this->assertSame($doulaId, $state['entries'][0]['user_id']);
    }

    public function test_former_members_is_empty_when_nobody_was_removed(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');

        $this->assertSame([], $this->getJson('/api/state', $this->authed($ben))->json('formerMembers'));
    }

    public function test_a_pending_invite_can_be_revoked(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $code = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');

        $this->postJson('/api/invite/revoke', ['email' => 'Katrina@Example.com'], $this->authed($ben))->assertOk();

        $state = $this->getJson('/api/state', $this->authed($ben))->json();
        $this->assertSame([], $state['invites']);
        $this->assertNull($state['invitePending']);
        // the revoked code opens no doors
        $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $code])->assertStatus(422);
        $this->assertSame(1, User::count());
    }

    // ── multiple children ─────────────────────────────────────────────────────

    public function test_children_can_be_added_renamed_and_archived_up_to_the_cap(): void
    {
        config(['babylog.max_children' => 2]);
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $this->postJson('/api/baby', ['name' => 'Maddux'], $this->authed($ben))->assertOk();

        $wrenId = $this->postJson('/api/children', ['name' => 'Wren', 'birthdate' => '2026-08-01'], $this->authed($ben))->assertOk()->json('child.id');

        // two children tracked, the cap says no third
        $this->postJson('/api/children', ['name' => 'Third'], $this->authed($ben))->assertStatus(422);

        // rename + archive by id; omitted fields survive (same rule as /baby)
        $this->postJson('/api/children', ['id' => $wrenId, 'name' => 'Wren B', 'archived' => true], $this->authed($ben))->assertOk();
        $children = $this->getJson('/api/state', $this->authed($ben))->json('children');
        $this->assertSame('Wren B', $children[1]['name']);
        $this->assertSame('2026-08-01', $children[1]['birthdate']);
        $this->assertTrue($children[1]['archived']);

        // an id from another household is a 422, not a write
        config(['babylog.open_registration' => true]);
        $eve = $this->register('Eve', 'eve@example.com')->json('token');
        $this->postJson('/api/children', ['id' => $wrenId, 'name' => 'Stolen'], $this->authed($eve))->assertStatus(422);
        $this->assertSame('Wren B', $this->getJson('/api/state', $this->authed($ben))->json('children.1.name'));
    }

    public function test_entries_carry_a_baby_id_and_legacy_pushes_land_on_the_primary_child(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $this->postJson('/api/baby', ['name' => 'Maddux'], $this->authed($ben))->assertOk();
        $wrenId = $this->postJson('/api/children', ['name' => 'Wren'], $this->authed($ben))->json('child.id');
        $primaryId = $this->getJson('/api/state', $this->authed($ben))->json('children.0.id');

        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'e-wren', 'type' => 'bottle', 't' => 1000, 'detail' => '3', 'baby_id' => $wrenId],
            ['id' => 'e-legacy', 'type' => 'bottle', 't' => 2000, 'detail' => '4'], // old client: no baby_id
        ]], $this->authed($ben))->assertOk();

        $entries = collect($this->getJson('/api/state?since=0', $this->authed($ben))->json('entries'))->keyBy('id');
        $this->assertSame($wrenId, $entries['e-wren']['baby_id']);
        $this->assertSame($primaryId, $entries['e-legacy']['baby_id']);
    }

    public function test_entry_update_without_a_baby_id_preserves_the_stored_one(): void
    {
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $this->postJson('/api/baby', ['name' => 'Maddux'], $this->authed($ben))->assertOk();
        $wrenId = $this->postJson('/api/children', ['name' => 'Wren'], $this->authed($ben))->json('child.id');

        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'e1', 'type' => 'bottle', 't' => 1000, 'detail' => '3', 'baby_id' => $wrenId],
        ]], $this->authed($ben))->assertOk();

        // an old client edits the amount, knowing nothing about children — the
        // entry must not silently jump back to the primary child
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'e1', 'type' => 'bottle', 't' => 1000, 'detail' => '5'],
        ]], $this->authed($ben))->assertOk();

        $entry = $this->getJson('/api/state?since=0', $this->authed($ben))->json('entries.0');
        $this->assertSame('5', $entry['detail']);
        $this->assertSame($wrenId, $entry['baby_id']);
    }

    public function test_a_baby_id_from_another_household_is_never_stored(): void
    {
        config(['babylog.open_registration' => true]);
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $eve = $this->register('Eve', 'eve@example.com')->json('token');
        $this->postJson('/api/baby', ['name' => 'Maddux'], $this->authed($ben))->assertOk();
        $this->postJson('/api/baby', ['name' => 'EveBaby'], $this->authed($eve))->assertOk();
        $benBabyId = $this->getJson('/api/state', $this->authed($ben))->json('children.0.id');
        $eveBabyId = $this->getJson('/api/state', $this->authed($eve))->json('children.0.id');
        $this->assertNotSame($benBabyId, $eveBabyId);

        // Ben pushes an entry pointed at Eve's child — the foreign id is
        // dropped and the write behaves as if no baby_id was sent
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'e1', 'type' => 'bottle', 't' => 1000, 'baby_id' => $eveBabyId],
        ]], $this->authed($ben))->assertOk();

        $entry = $this->getJson('/api/state?since=0', $this->authed($ben))->json('entries.0');
        $this->assertSame($benBabyId, $entry['baby_id']);
    }

    public function test_an_entry_can_name_another_member_as_its_author(): void
    {
        [$ben, $kat] = $this->threeMemberHousehold();
        $benId = $this->getJson('/api/state', $this->authed($ben))->json('user.id');

        // Katrina stops a nursing session Ben started and logs it as his: any
        // member can stop any timer, but the feed stays credited to whoever
        // actually did it, not to whoever was free to press Stop
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'e1', 'type' => 'nurse', 't' => 1000, 'detail' => 'Left · 30m', 'user_id' => $benId],
        ]], $this->authed($kat))->assertOk();

        $this->assertSame($benId, $this->getJson('/api/state?since=0', $this->authed($kat))->json('entries.0.user_id'));
    }

    public function test_an_author_from_another_household_is_never_stored(): void
    {
        config(['babylog.open_registration' => true]);
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $eve = $this->register('Eve', 'eve@example.com')->json('token');
        $benId = $this->getJson('/api/state', $this->authed($ben))->json('user.id');
        $eveId = $this->getJson('/api/state', $this->authed($eve))->json('user.id');
        $this->assertNotSame($benId, $eveId);

        // Ben names Eve as the author — the foreign id is dropped and the write
        // behaves as if no user_id was sent, exactly like a foreign baby_id
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'e1', 'type' => 'bottle', 't' => 1000, 'user_id' => $eveId],
        ]], $this->authed($ben))->assertOk();

        $this->assertSame($benId, $this->getJson('/api/state?since=0', $this->authed($ben))->json('entries.0.user_id'));
    }

    public function test_editing_an_entry_never_re_homes_its_author(): void
    {
        [$ben, $kat] = $this->threeMemberHousehold();
        $benId = $this->getJson('/api/state', $this->authed($ben))->json('user.id');
        $katId = $this->getJson('/api/state', $this->authed($kat))->json('user.id');

        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'e1', 'type' => 'bottle', 't' => 1000, 'detail' => '4'],
        ]], $this->authed($ben))->assertOk();

        // Katrina fixes the amount and names herself — author is create-only,
        // so Ben keeps the entry (same rule baby_id already follows)
        $this->postJson('/api/entries', ['entries' => [
            ['id' => 'e1', 'type' => 'bottle', 't' => 1000, 'detail' => '5', 'user_id' => $katId],
        ]], $this->authed($kat))->assertOk();

        $entry = $this->getJson('/api/state?since=0', $this->authed($kat))->json('entries.0');
        $this->assertSame('5', $entry['detail']);
        $this->assertSame($benId, $entry['user_id']);
    }

    public function test_timer_carries_a_validated_baby_id(): void
    {
        config(['babylog.open_registration' => true]);
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $eve = $this->register('Eve', 'eve@example.com')->json('token');
        $this->postJson('/api/baby', ['name' => 'Maddux'], $this->authed($ben))->assertOk();
        $this->postJson('/api/baby', ['name' => 'EveBaby'], $this->authed($eve))->assertOk();
        $wrenId = $this->postJson('/api/children', ['name' => 'Wren'], $this->authed($ben))->json('child.id');
        $eveBabyId = $this->getJson('/api/state', $this->authed($eve))->json('children.0.id');

        $this->postJson('/api/timer/start', ['type' => 'nurse', 'baby_id' => $wrenId], $this->authed($ben))->assertOk();
        $this->assertSame($wrenId, $this->getJson('/api/state', $this->authed($ben))->json('timer.baby_id'));

        // a foreign child id is dropped, not stored
        $this->postJson('/api/timer/start', ['type' => 'nurse', 'baby_id' => $eveBabyId], $this->authed($ben))->assertOk();
        $this->assertNull($this->getJson('/api/state', $this->authed($ben))->json('timer.baby_id'));
    }

    // ── shifts with three members ─────────────────────────────────────────────

    public function test_handback_returns_duty_to_the_requester_not_the_first_member(): void
    {
        [$ben, $kat, $doula] = $this->threeMemberHousehold();
        $katId = $this->getJson('/api/state', $this->authed($kat))->json('user.id');
        $doulaId = $this->getJson('/api/state', $this->authed($doula))->json('user.id');

        // Katrina (the SECOND member) asks for cover; the doula takes it
        $this->postJson('/api/shifts/request', ['note' => 'dentist'], $this->authed($kat))->assertOk();
        $this->postJson('/api/shifts/accept', ['plan' => [], 'until' => 'Until 3 PM'], $this->authed($doula))->assertOk();
        $this->assertSame($doulaId, $this->getJson('/api/state', $this->authed($ben))->json('onDutyUserId'));

        // handback must follow the stored requester (Katrina) — a "first other
        // member" inference would wrongly crown Ben
        $this->postJson('/api/shifts/handback', ['note' => 'all fed'], $this->authed($doula))->assertOk();
        $this->assertSame($katId, $this->getJson('/api/state', $this->authed($ben))->json('onDutyUserId'));
    }

    public function test_the_ask_carries_the_plan_and_window_the_asker_proposed(): void
    {
        [$ben, $kat] = $this->threeMemberHousehold();
        $plan = [['id' => 'p1', 'type' => 'bottle', 'at' => 1788385718170.4], ['id' => 'p2', 'type' => 'meds', 'at' => 1788400000000]];

        // the person handing off authors the plan — the receiver used to have to
        // invent it from their own device's guess at the rhythm
        $this->postJson('/api/shifts/request', [
            'note' => 'bottle in the fridge', 'plan' => $plan, 'until' => 'Until 6 AM', 'until_at' => 1788400000000,
        ], $this->authed($ben))->assertOk();

        $asked = $this->getJson('/api/state', $this->authed($kat))->json('shift');
        $this->assertSame('requested', $asked['state']);
        $this->assertSame(1788385718170, $asked['plan'][0]['at']); // fractional ms coerced, same as accept
        $this->assertSame('meds', $asked['plan'][1]['type']);
        $this->assertSame('Until 6 AM', $asked['until']);

        // accepting without sending a plan inherits what was proposed rather
        // than silently blanking it
        $this->postJson('/api/shifts/accept', [], $this->authed($kat))->assertOk();
        $live = $this->getJson('/api/state', $this->authed($ben))->json('shift');
        $this->assertSame('active', $live['state']);
        $this->assertCount(2, $live['plan']);
        $this->assertSame('Until 6 AM', $live['until']);
        $this->assertSame(1788400000000, $live['until_at']);
    }

    public function test_the_accepter_can_override_the_plan_they_were_sent(): void
    {
        [$ben, $kat] = $this->threeMemberHousehold();
        $this->postJson('/api/shifts/request', [
            'plan' => [['id' => 'p1', 'type' => 'bottle', 'at' => 1788385718170]], 'until' => 'Until 6 AM',
        ], $this->authed($ben))->assertOk();

        // seeded, not binding: what the accepter commits is what sticks
        $this->postJson('/api/shifts/accept', [
            'plan' => [['id' => 'p9', 'type' => 'nurse', 'at' => 1788390000000]], 'until' => 'Open-ended',
        ], $this->authed($kat))->assertOk();

        $live = $this->getJson('/api/state', $this->authed($ben))->json('shift');
        $this->assertCount(1, $live['plan']);
        $this->assertSame('nurse', $live['plan'][0]['type']);
        $this->assertSame('Open-ended', $live['until']);
    }

    public function test_an_addressed_ask_pings_only_its_target(): void
    {
        [$ben, $kat, $doula] = $this->threeMemberHousehold();
        $doulaId = $this->getJson('/api/state', $this->authed($doula))->json('user.id');

        $fake = $this->fakePush();
        $this->postJson('/api/shifts/request', ['note' => 'can you cover?', 'target_id' => $doulaId], $this->authed($ben))->assertOk();

        // you ask the night carer, not the whole house
        $this->assertCount(1, $fake->sent);
        $this->assertSame($doulaId, $fake->sent[0]['user_id']);
        $this->assertSame($doulaId, $this->getJson('/api/state', $this->authed($kat))->json('shift.target_id'));

        // addressed, not reserved — anyone may still answer it
        $this->postJson('/api/shifts/accept', [], $this->authed($kat))->assertOk();
        $this->assertSame('active', $this->getJson('/api/state', $this->authed($ben))->json('shift.state'));
    }

    public function test_an_ask_cannot_be_addressed_outside_the_household(): void
    {
        [$ben, $kat] = $this->threeMemberHousehold();
        $benId = $this->getJson('/api/state', $this->authed($ben))->json('user.id');

        $fake = $this->fakePush();
        // a stranger's id, and your own — neither is a member you can address
        $this->postJson('/api/shifts/request', ['target_id' => 99999], $this->authed($ben))->assertOk();
        $this->assertNull($this->getJson('/api/state', $this->authed($kat))->json('shift.target_id'));

        $this->postJson('/api/shifts/request', ['target_id' => $benId], $this->authed($ben))->assertOk();
        $this->assertNull($this->getJson('/api/state', $this->authed($kat))->json('shift.target_id'));

        // both fell back to the open ask: two members reached, twice, nobody else
        $this->assertCount(4, $fake->sent);
        $this->assertNotContains($benId, array_column($fake->sent, 'user_id'));
    }

    public function test_handback_falls_back_to_a_parent_not_a_caregiver(): void
    {
        // caregiver invited FIRST, so "the first other member by id" is the carer
        $ben = $this->register('Ben', 'ben@example.com')->json('token');
        $codeCarer = $this->postJson('/api/invite', ['email' => 'doula@example.com', 'role' => 'caregiver'], $this->authed($ben))->json('code');
        $carer = $this->postJson('/api/register', ['name' => 'Robin', 'email' => 'doula@example.com', 'password' => 'password123', 'invite' => $codeCarer])->json('token');
        $codeKat = $this->postJson('/api/invite', ['email' => 'katrina@example.com'], $this->authed($ben))->json('code');
        $kat = $this->postJson('/api/register', ['name' => 'Katrina', 'email' => 'katrina@example.com', 'password' => 'password123', 'invite' => $codeKat])->json('token');
        $carerId = $this->getJson('/api/state', $this->authed($carer))->json('user.id');
        $katId = $this->getJson('/api/state', $this->authed($kat))->json('user.id');

        // Ben starts a shift himself — no requester to return duty to — and hands back
        $this->postJson('/api/shifts/accept', ['plan' => []], $this->authed($ben))->assertOk();
        $this->postJson('/api/shifts/handback', [], $this->authed($ben))->assertOk();

        $this->assertSame($katId, $this->getJson('/api/state', $this->authed($ben))->json('onDutyUserId'));
        $this->assertNotSame($carerId, $this->getJson('/api/state', $this->authed($ben))->json('onDutyUserId'));
    }

    public function test_handback_still_returns_duty_to_a_caregiver_who_asked_for_it(): void
    {
        [$ben, $kat, $doula] = $this->threeMemberHousehold();
        $doulaId = $this->getJson('/api/state', $this->authed($doula))->json('user.id');

        // preferring parents is a *fallback* rule — an explicit ask still wins,
        // or a carer could never get a break mid-shift
        $this->postJson('/api/shifts/request', ['note' => 'stepping out'], $this->authed($doula))->assertOk();
        $this->postJson('/api/shifts/accept', [], $this->authed($kat))->assertOk();
        $this->postJson('/api/shifts/handback', [], $this->authed($kat))->assertOk();

        $this->assertSame($doulaId, $this->getJson('/api/state', $this->authed($ben))->json('onDutyUserId'));
    }

    public function test_you_cannot_accept_your_own_handoff_request(): void
    {
        [$ben] = $this->threeMemberHousehold();
        $benId = $this->getJson('/api/state', $this->authed($ben))->json('user.id');

        $this->postJson('/api/shifts/request', ['note' => 'so tired'], $this->authed($ben))->assertOk();
        $this->postJson('/api/shifts/accept', ['plan' => []], $this->authed($ben))->assertStatus(422);

        // the ask is still open for someone else, duty unmoved
        $state = $this->getJson('/api/state', $this->authed($ben))->json();
        $this->assertSame('requested', $state['shift']['state']);
        $this->assertSame($benId, $state['onDutyUserId']);
    }
}

// used by test_account_provisioner_is_swappable_via_config — lives here because
// the app ships no second AccountProvisioner implementation
class FreshHouseholdProvisioner implements AccountProvisioner
{
    public function provision(string $email): Household
    {
        return Household::create();
    }
}
