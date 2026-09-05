<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace Tests\Feature;

use App\Models\Baby;
use App\Models\Entry;
use App\Models\Household;
use App\Models\Invite;
use App\Models\PushSubscription;
use App\Models\Shift;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The babylog:* admin commands — the no-SSH appliance's escape hatches
 * (docs/operations.md "Admin commands"). They act below the API layer, so
 * these tests pin their semantics to the equivalent in-app flows: reset
 * revokes sessions like the reset-link flow, remove-user mirrors
 * /household/remove-member, delete-household frees the instance claim.
 */
class AdminCommandsTest extends TestCase
{
    use RefreshDatabase;

    /** A household of $emails users (first one on duty), with one child and one entry each. */
    private function household(array $emails, array $roles = []): Household
    {
        $household = Household::create();
        foreach ($emails as $i => $email) {
            $user = User::create([
                'name' => ucfirst(strtok($email, '@')),
                'email' => $email,
                'password' => 'password123',
                'household_id' => $household->id,
                'role' => $roles[$i] ?? 'parent',
            ]);
            if ($i === 0) {
                $household->update(['on_duty_user_id' => $user->id]);
            }
            Entry::create([
                'id' => (string) Str::uuid(), 'household_id' => $household->id, 'user_id' => $user->id,
                'type' => 'bottle', 't' => now()->getTimestampMs(), 'detail' => '4', 'deleted' => false, 'rev' => 1,
            ]);
        }
        Baby::create(['household_id' => $household->id, 'name' => 'Wren']);

        return $household->fresh();
    }

    // ── babylog:users ─────────────────────────────────────────────────────────

    public function test_users_overview_lists_households_members_and_children(): void
    {
        $this->household(['ben@example.com', 'ada@example.com'], ['parent', 'caregiver']);

        $this->artisan('babylog:users')
            ->expectsOutputToContain('Household #1 — 2 members, 1 child, 2 entries')
            ->expectsOutputToContain('ben@example.com')
            ->expectsOutputToContain('caregiver')
            ->expectsOutputToContain('child: Wren')
            ->assertSuccessful();
    }

    public function test_users_overview_on_a_fresh_instance_says_so(): void
    {
        $this->artisan('babylog:users')
            ->expectsOutputToContain('the next sign-up claims this instance')
            ->assertSuccessful();
    }

    // ── babylog:reset-password ────────────────────────────────────────────────

    public function test_reset_password_sets_the_given_password_and_revokes_sessions(): void
    {
        $this->household(['ben@example.com']);
        $ben = User::firstWhere('email', 'ben@example.com');
        $ben->createToken('app');

        $this->artisan('babylog:reset-password', ['email' => 'Ben@Example.com', '--password' => 'newpass99'])
            ->expectsOutputToContain('Password reset for Ben')
            ->assertSuccessful();

        $ben->refresh();
        $this->assertTrue(Hash::check('newpass99', $ben->password));
        $this->assertSame(0, $ben->tokens()->count());
    }

    public function test_reset_password_generates_and_prints_one_when_not_given(): void
    {
        $this->household(['ben@example.com']);
        $before = User::firstWhere('email', 'ben@example.com')->password;

        $this->artisan('babylog:reset-password', ['email' => 'ben@example.com'])
            ->expectsOutputToContain('New password: ')
            ->assertSuccessful();

        $this->assertNotSame($before, User::firstWhere('email', 'ben@example.com')->password);
    }

    public function test_reset_password_rejects_unknown_emails_and_short_passwords(): void
    {
        $this->household(['ben@example.com']);
        $this->artisan('babylog:reset-password', ['email' => 'nobody@example.com'])->assertFailed();
        $this->artisan('babylog:reset-password', ['email' => 'ben@example.com', '--password' => 'short'])->assertFailed();
        $this->assertTrue(Hash::check('password123', User::firstWhere('email', 'ben@example.com')->password));
    }

    // ── babylog:remove-user ───────────────────────────────────────────────────

    public function test_remove_user_mirrors_the_remove_member_endpoint(): void
    {
        $h = $this->household(['ben@example.com', 'ada@example.com']);
        $ben = User::firstWhere('email', 'ben@example.com'); // on duty
        $ada = User::firstWhere('email', 'ada@example.com');
        $ben->createToken('app');
        PushSubscription::create(['user_id' => $ben->id, 'endpoint' => 'https://push.example/1', 'p256dh' => 'k', 'auth' => 'a']);
        Shift::create(['household_id' => $h->id, 'state' => 'requested', 'requester_id' => $ben->id]);

        $this->artisan('babylog:remove-user', ['email' => 'ben@example.com', '--force' => true])
            ->expectsOutputToContain('Removed ben@example.com')
            ->assertSuccessful();

        $this->assertNull(User::find($ben->id));
        $h->refresh();
        $this->assertSame($ada->id, $h->on_duty_user_id, 'duty falls to the remaining parent');
        $this->assertSame([['id' => $ben->id, 'name' => 'Ben']], $h->former_members, 'name snapshot keeps old entries attributable');
        $this->assertSame('cancelled', Shift::first()->state);
        $this->assertSame(0, PushSubscription::count());
        $this->assertSame(2, Entry::count(), 'their entries stay');
    }

    public function test_remove_user_refuses_the_last_member_and_points_at_delete_household(): void
    {
        $this->household(['ben@example.com']);

        $this->artisan('babylog:remove-user', ['email' => 'ben@example.com', '--force' => true])
            ->expectsOutputToContain('babylog:delete-household')
            ->assertFailed();

        $this->assertSame(1, User::count());
    }

    public function test_remove_user_aborts_without_confirmation(): void
    {
        $this->household(['ben@example.com', 'ada@example.com']);

        $this->artisan('babylog:remove-user', ['email' => 'ben@example.com'])
            ->expectsConfirmation('Remove this member?', 'no')
            ->assertFailed();

        $this->assertSame(2, User::count());
    }

    // ── babylog:delete-household ──────────────────────────────────────────────

    public function test_delete_household_removes_everything_scoped_and_frees_the_claim(): void
    {
        $h = $this->household(['ben@example.com', 'ada@example.com']);
        $ben = User::firstWhere('email', 'ben@example.com');
        $ben->createToken('app');
        PushSubscription::create(['user_id' => $ben->id, 'endpoint' => 'https://push.example/1', 'p256dh' => 'k', 'auth' => 'a']);
        Shift::create(['household_id' => $h->id, 'state' => 'requested', 'requester_id' => $ben->id]);
        Invite::create(['household_id' => $h->id, 'email' => 'nana@example.com', 'code_hash' => hash('sha256', 'ABC123'), 'role' => 'caregiver']);

        $this->artisan('babylog:delete-household', ['household' => $h->id, '--force' => true])
            ->expectsOutputToContain('2 entries')
            ->expectsOutputToContain('No accounts remain — the next sign-up claims this instance.')
            ->assertSuccessful();

        $this->assertSame(0, Household::count());
        $this->assertSame(0, User::count());
        $this->assertSame(0, Entry::count());
        $this->assertSame(0, Baby::count());
        $this->assertSame(0, Shift::count());
        $this->assertSame(0, Invite::count());
        $this->assertSame(0, PushSubscription::count());
        $this->assertSame(0, $ben->tokens()->count());

        // the claim really is free again: an uninvited sign-up succeeds
        $this->postJson('/api/register', ['name' => 'New', 'email' => 'new@example.com', 'password' => 'password123'])
            ->assertCreated();
    }

    public function test_delete_household_leaves_other_households_alone(): void
    {
        $doomed = $this->household(['ben@example.com']);
        $kept = $this->household(['zoe@example.com']);

        $this->artisan('babylog:delete-household', ['household' => $doomed->id, '--force' => true])
            ->assertSuccessful();

        $this->assertSame([$kept->id], Household::pluck('id')->all());
        $this->assertSame(['zoe@example.com'], User::pluck('email')->all());
        $this->assertSame(1, Entry::count());
        $this->assertSame(1, Baby::count());
    }

    public function test_delete_household_rejects_unknown_ids_and_aborts_without_confirmation(): void
    {
        $h = $this->household(['ben@example.com']);

        $this->artisan('babylog:delete-household', ['household' => 999, '--force' => true])->assertFailed();
        $this->artisan('babylog:delete-household', ['household' => $h->id])
            ->expectsConfirmation('Delete this household?', 'no')
            ->assertFailed();

        $this->assertSame(1, Household::count());
    }
}
