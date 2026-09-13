<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Http\Controllers\Api;

use App\Events\HouseholdTouched;
use App\Http\Controllers\Controller;
use App\Mail\PartnerInvite;
use App\Models\User;
use App\Services\EntryWriter;
use App\Services\PushService;
use App\Support\AppMail;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;

class SyncController extends Controller
{
    /**
     * Single polling endpoint: everything the client needs to converge.
     * ?since=<ms> limits entries to ones written after that server revision.
     */
    public function state(Request $request): JsonResponse
    {
        $user = $request->user();
        $household = $user->household()->with(['users', 'children'])->first();
        $since = (int) $request->query('since', 0);

        $partner = $household->partnerOf($user);
        $primary = $household->children->first();
        $invites = $household->invites()->orderBy('id')->get();
        $entries = $household->entries()
            ->where('rev', '>', $since)
            ->orderBy('rev')
            ->limit(2000)
            ->get(['id', 'user_id', 'baby_id', 'type', 't', 'detail', 'deleted', 'rev']);

        $shift = $household->shifts()->latest('id')->first();

        return response()->json([
            'user' => ['id' => $user->id, 'name' => $user->name, 'email' => $user->email, 'role' => $user->role ?? 'parent', 'householdId' => $user->household_id, 'notifyPrefs' => $user->notifyPrefs()],
            // legacy singular key: "the other grown-up" is now just the first other member
            'partner' => $partner ? ['id' => $partner->id, 'name' => $partner->name] : null,
            'members' => $household->users->sortBy('id')->values()
                ->map(fn (User $u) => ['id' => $u->id, 'name' => $u->name, 'role' => $u->role ?? 'parent'])->all(),
            // who used to be here — snapshots taken at remove-member time so
            // old entries' user_ids still resolve to a name
            'formerMembers' => collect($household->former_members ?? [])
                ->map(fn ($m) => ['id' => (int) $m['id'], 'name' => (string) $m['name']])->values()->all(),
            'invites' => $invites->map(fn ($i) => ['email' => $i->email, 'role' => $i->role])->all(),
            // old clients only know about one pending seat — show them the first
            'invitePending' => $invites->first()?->email,
            // legacy singular key: the primary (oldest) child
            'baby' => $primary ? ['name' => $primary->name, 'age' => $primary->age_label, 'birthdate' => $primary->birthdate] : null,
            'children' => $household->children
                ->map(fn ($b) => ['id' => $b->id, 'name' => $b->name, 'age' => $b->age_label, 'birthdate' => $b->birthdate, 'archived' => (bool) $b->archived])->all(),
            'onDutyUserId' => $household->on_duty_user_id,
            'settings' => $household->settings,
            'shift' => $shift,
            // legacy singular key: installed PWAs that predate multi-timer show
            // one banner and stop it without an id — give them their own timer
            'timer' => $household->legacyTimerFor($user),
            'timers' => $household->runningTimers(),
            'entries' => $entries,
            // server caps, so clients can grey out "add" buttons instead of 422ing
            'limits' => [
                'maxMembers' => (int) config('babylog.max_household_users'),
                'maxChildren' => (int) config('babylog.max_children'),
            ],
            'serverTime' => now()->getTimestampMs(),
            'vapidPublicKey' => app(PushService::class)->publicKey(),
        ]);
    }

    /** Caregivers log and cover shifts; only parents shape the household itself. */
    private function parentsOnly(Request $request): ?JsonResponse
    {
        return $request->user()->isParent()
            ? null
            : response()->json(['message' => __('Only a parent can change that.')], 403);
    }

    public function setBaby(Request $request): JsonResponse
    {
        if ($denied = $this->parentsOnly($request)) {
            return $denied;
        }

        $data = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'age' => ['nullable', 'string', 'max:40'],
            'birthdate' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:today', 'after:2015-01-01'],
        ]);

        $household = $request->user()->household;
        // only touch fields the client sent — a client that doesn't know the DOB must not erase it
        $values = ['name' => $data['name']];
        if (array_key_exists('age', $data)) {
            $values['age_label'] = $data['age'];
        }
        if (array_key_exists('birthdate', $data)) {
            $values['birthdate'] = $data['birthdate'];
        }
        $household->baby()->updateOrCreate(['household_id' => $household->id], $values);

        HouseholdTouched::send($household->id, 'baby');

        return response()->json(['ok' => true]);
    }

    /**
     * Create or update one child. There is no delete — a child's log is
     * history worth keeping, so retiring one only ever sets `archived`.
     */
    public function setChild(Request $request): JsonResponse
    {
        if ($denied = $this->parentsOnly($request)) {
            return $denied;
        }

        $data = $request->validate([
            'id' => ['sometimes', 'integer'],
            'name' => ['required', 'string', 'max:100'],
            'age' => ['nullable', 'string', 'max:40'],
            'birthdate' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:today', 'after:2015-01-01'],
            'archived' => ['sometimes', 'boolean'],
        ]);

        $household = $request->user()->household;
        if (isset($data['id'])) {
            // the id must be one of ours — a guessed id from another household is a 422, not a write
            $child = $household->children()->find($data['id']);
            if (! $child) {
                return response()->json(['message' => __('That child isn’t in this log.')], 422);
            }
        } else {
            if ($household->children()->count() >= config('babylog.max_children')) {
                return response()->json(['message' => __('This log is at its limit of children.')], 422);
            }
            $child = $household->children()->make();
        }

        // only touch fields the client sent — same omission rule as /baby
        $values = ['name' => $data['name']];
        if (array_key_exists('age', $data)) {
            $values['age_label'] = $data['age'];
        }
        if (array_key_exists('birthdate', $data)) {
            $values['birthdate'] = $data['birthdate'];
        }
        if (array_key_exists('archived', $data)) {
            $values['archived'] = (bool) $data['archived'];
        }
        $child->fill($values)->save();

        HouseholdTouched::send($household->id, 'children');

        return response()->json(['ok' => true, 'child' => [
            'id' => $child->id, 'name' => $child->name, 'age' => $child->age_label,
            'birthdate' => $child->birthdate, 'archived' => (bool) $child->archived,
        ]]);
    }

    public function invite(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email', 'max:255'],
            'role' => ['sometimes', 'string', 'in:parent,caregiver'],
        ]);

        $user = $request->user();
        if (! $user->isParent()) {
            return response()->json(['message' => __('Only a parent can invite people to this log.')], 403);
        }

        $household = $user->household;
        $email = strtolower($data['email']);

        // seats = members + outstanding invites; re-inviting the same email
        // replaces its row, so that one doesn't count against the cap
        $pendingOthers = $household->invites()->where('email', '!=', $email)->count();
        if ($household->users()->count() + $pendingOthers >= config('babylog.max_household_users')) {
            return response()->json(['message' => __('This log is full.')], 422);
        }

        // single-use code, shown once to the inviter; the invitee enters it at sign-up
        $code = '';
        $alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        for ($i = 0; $i < 6; $i++) {
            $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }

        $household->invites()->updateOrCreate(
            ['email' => $email],
            [
                'code_hash' => hash('sha256', $code),
                'role' => $data['role'] ?? 'parent',
                'invited_by' => $user->id,
            ],
        );

        // with SMTP configured the invitee also gets the code by email; the
        // on-screen code stays the source of truth either way
        $mailed = false;
        if (AppMail::configured()) {
            try {
                // the invitee has no account yet — the inviter's language
                // (this request's locale) is the best available guess
                Mail::to($email)->locale(app()->getLocale())->send(new PartnerInvite(
                    $user->name,
                    $household->baby?->name,
                    $code,
                    rtrim((string) config('app.url'), '/'),
                ));
                $mailed = true;
            } catch (\Throwable) {
                // bad SMTP creds must not kill the invite — the code still works
            }
        }

        HouseholdTouched::send($household->id, 'invite');

        return response()->json(['ok' => true, 'code' => $code, 'mailed' => $mailed]);
    }

    /** Take back a pending invite — the emailed/shown code stops opening doors. */
    public function revokeInvite(Request $request): JsonResponse
    {
        if ($denied = $this->parentsOnly($request)) {
            return $denied;
        }

        $data = $request->validate(['email' => ['required', 'email', 'max:255']]);

        $household = $request->user()->household;
        $household->invites()->where('email', strtolower($data['email']))->delete();

        HouseholdTouched::send($household->id, 'invite');

        return response()->json(['ok' => true]);
    }

    /**
     * Remove a member (a departing caregiver, usually). Their sessions and
     * devices die immediately; their entries keep their user_id so the log's
     * history still says who did what.
     */
    public function removeMember(Request $request): JsonResponse
    {
        if ($denied = $this->parentsOnly($request)) {
            return $denied;
        }

        $data = $request->validate(['user_id' => ['required', 'integer']]);

        $user = $request->user();
        $household = $user->household;
        if ((int) $data['user_id'] === $user->id) {
            return response()->json(['message' => __('You can’t remove yourself from your own log.')], 422);
        }
        $target = $household->users()->find($data['user_id']);
        if (! $target) {
            return response()->json(['message' => __('That person isn’t in this log.')], 422);
        }

        $target->tokens()->delete();            // every session 401s from here on
        $target->pushSubscriptions()->delete(); // no more pushes at their devices

        // duty can't sit with someone who's gone, and their in-flight shift
        // paperwork would only render ghost cards
        if ($household->on_duty_user_id === $target->id) {
            $household->update(['on_duty_user_id' => $user->id]);
        }
        $household->shifts()->where('state', 'requested')->where('requester_id', $target->id)
            ->update(['state' => 'cancelled']);
        $household->shifts()->where('state', 'active')->where('user_id', $target->id)
            ->update(['state' => 'cancelled', 'ended_at' => now()->getTimestampMs()]);

        // snapshot {id, name} before the row goes: entries keep their user_id,
        // and this list lets clients still put a name to it (dedupe by id in
        // case an id is ever seen twice)
        $former = collect($household->former_members ?? [])
            ->reject(fn ($m) => (int) ($m['id'] ?? 0) === $target->id)
            ->push(['id' => $target->id, 'name' => $target->name])
            ->values()->all();
        $household->update(['former_members' => $former]);

        $target->delete();

        HouseholdTouched::send($household->id, 'members');

        return response()->json(['ok' => true]);
    }

    /** Trackers the household can switch off; feeds are core and not listed. */
    private const TRACKS = ['pump', 'diapers', 'sleep', 'tummy', 'bath', 'meds'];

    /** "Since last …" cards the household can choose to show on the Now screen. */
    private const WIDGETS = ['feeds', 'pump', 'diapers', 'sleep', 'tummy', 'bath', 'meds'];

    /** Seven-day bar charts the household can choose to show on History. */
    private const CHARTS = ['feeds', 'sleep', 'diapers', 'pump', 'tummy', 'bath', 'meds'];

    /** Theme presets — keys only; the client maps them to actual colors. */
    private const THEME_ACCENTS = ['olive', 'clay', 'rose', 'plum', 'sea', 'denim'];

    private const THEME_BGS = ['cream', 'blush', 'mist', 'sage', 'lilac'];

    /** Household-level preferences (tracking toggles, dismissed nudges, Now-screen widgets, History charts, theme). Last write wins. */
    public function setSettings(Request $request): JsonResponse
    {
        if ($denied = $this->parentsOnly($request)) {
            return $denied;
        }

        $data = $request->validate([
            'tracking' => ['sometimes', 'array'],
            'tracking.*' => ['boolean'],
            'dismissed' => ['sometimes', 'array', 'max:20'],
            'dismissed.*' => ['string', 'max:30'],
            // nullable: clients that never customized widgets echo back null
            'widgets' => ['sometimes', 'nullable', 'array', 'max:8'],
            'widgets.*' => ['string', 'max:20'],
            // same story as widgets — absent or null means "never customized"
            'charts' => ['sometimes', 'nullable', 'array', 'max:8'],
            'charts.*' => ['string', 'max:20'],
            'theme' => ['sometimes', 'nullable', 'array'],
            'theme.accent' => ['sometimes', 'string', 'in:'.implode(',', self::THEME_ACCENTS)],
            'theme.bg' => ['sometimes', 'string', 'in:'.implode(',', self::THEME_BGS)],
            // display unit only — entry amounts are stored and synced in oz regardless
            'unit' => ['sometimes', 'string', 'in:oz,ml'],
            // what the daily meds dose is called; clients default a blank/absent name to "Vitamin D" on read
            'medName' => ['sometimes', 'nullable', 'string', 'max:40'],
        ]);

        $household = $request->user()->household;
        $settings = $household->settings ?? [];
        if (array_key_exists('tracking', $data)) {
            $settings['tracking'] = array_map(
                fn ($v) => (bool) $v,
                array_intersect_key($data['tracking'], array_flip(self::TRACKS)),
            );
        }
        if (array_key_exists('dismissed', $data)) {
            $settings['dismissed'] = array_values(array_intersect($data['dismissed'], self::TRACKS));
        }
        if (is_array($data['widgets'] ?? null)) {
            // keep the client's order, drop unknowns and duplicates
            $settings['widgets'] = array_values(array_unique(array_intersect($data['widgets'], self::WIDGETS)));
        }
        if (is_array($data['charts'] ?? null)) {
            $settings['charts'] = array_values(array_unique(array_intersect($data['charts'], self::CHARTS)));
        }
        if (is_array($data['theme'] ?? null)) {
            $settings['theme'] = array_intersect_key($data['theme'], array_flip(['accent', 'bg']));
        }
        if (array_key_exists('unit', $data)) {
            $settings['unit'] = $data['unit'];
        }
        if (array_key_exists('medName', $data)) {
            $settings['medName'] = trim((string) ($data['medName'] ?? ''));
        }
        $household->update(['settings' => $settings]);

        HouseholdTouched::send($household->id, 'settings');

        return response()->json(['ok' => true, 'settings' => $settings]);
    }

    /** Batch upsert from the client outbox. Client ids win; latest write wins. */
    public function pushEntries(Request $request, EntryWriter $writer): JsonResponse
    {
        $data = $request->validate([
            'entries' => ['required', 'array', 'max:500'],
            'entries.*.id' => ['required', 'string', 'max:64'],
            'entries.*.type' => ['required', 'string', 'max:20'],
            'entries.*.t' => ['required', 'integer'],
            'entries.*.detail' => ['nullable', 'string', 'max:100'],
            'entries.*.deleted' => ['nullable', 'boolean'],
            'entries.*.baby_id' => ['nullable', 'integer'],
            // whose activity this was — only honored for members of the
            // caller's household, and only on create (see EntryWriter)
            'entries.*.user_id' => ['nullable', 'integer'],
        ]);

        $writer->upsert($request->user(), $data['entries']);

        return response()->json(['ok' => true, 'serverTime' => now()->getTimestampMs()]);
    }
}
