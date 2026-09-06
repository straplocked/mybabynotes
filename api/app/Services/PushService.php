<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Services;

use App\Models\User;
use GuzzleHttp\Client;
use Illuminate\Support\Facades\DB;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\VAPID;
use Minishlink\WebPush\WebPush;

/**
 * Web Push transport. Like HouseholdTouched, delivery is best-effort — a dead
 * push service must never fail the write (or the scheduler tick) that asked
 * for it. Whether a notification *should* go out is the caller's job; this
 * class only ships it to every device the user opted in.
 */
class PushService
{
    private ?WebPush $client = null;

    private ?array $keys = null;

    /**
     * Copy is either a plain string (data — a user-typed note, a name) or a
     * translatable `[key, params]` pair rendered per SUBSCRIPTION in that
     * device's language (lang/{code}.json, English keys, English fallback).
     * A param value may itself be a `[key]`/`[key, params]` pair — that's how
     * type labels and "the baby" fallbacks land in the recipient's language
     * inside an already-translated sentence.
     */
    public static function render(string|array $copy, ?string $lang): string
    {
        if (is_string($copy)) {
            return $copy;
        }
        $params = $copy[1] ?? [];
        foreach ($params as $k => $v) {
            if (is_array($v)) {
                $params[$k] = self::render($v, $lang);
            }
        }

        return __($copy[0], $params, $lang ?: 'en');
    }

    public function notify(User $user, string $tag, string|array $title, string|array $body): void
    {
        try {
            $subs = $user->pushSubscriptions;
            if ($subs->isEmpty()) {
                return;
            }
            foreach ($subs as $sub) {
                // per-device language, falling back to the account's last-seen
                // one — a Spanish phone and an English phone on the same
                // account each get their own copy of the same event
                $lang = $sub->lang ?: ($user->lang ?: 'en');
                $payload = json_encode([
                    'title' => self::render($title, $lang),
                    'body' => self::render($body, $lang),
                    'tag' => $tag,
                ]);
                $report = $this->client()->sendOneNotification(
                    Subscription::create([
                        'endpoint' => $sub->endpoint,
                        'publicKey' => $sub->p256dh,
                        'authToken' => $sub->auth,
                    ]),
                    $payload,
                    ['TTL' => 12 * 3600, 'urgency' => 'high'],
                );
                if ($report->isSubscriptionExpired()) {
                    $sub->delete(); // browser dropped the subscription — stop pushing at it
                }
            }
        } catch (\Throwable) {
            // no push today — the app still converges through its normal sync
        }
    }

    /** The VAPID public key the client needs to subscribe. */
    public function publicKey(): string
    {
        return $this->keys()['publicKey'];
    }

    /**
     * Env override first (hosted / advanced setups), otherwise a keypair
     * generated once into SQLite so self-hosted instances need zero config.
     */
    private function keys(): array
    {
        if ($this->keys) {
            return $this->keys;
        }
        if (config('babylog.vapid_public') && config('babylog.vapid_private')) {
            return $this->keys = [
                'publicKey' => config('babylog.vapid_public'),
                'privateKey' => config('babylog.vapid_private'),
            ];
        }
        $row = DB::table('vapid_keys')->first();
        if (! $row) {
            $created = VAPID::createVapidKeys();
            DB::table('vapid_keys')->insert([
                'public_key' => $created['publicKey'],
                'private_key' => $created['privateKey'],
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $row = DB::table('vapid_keys')->first();
        }

        return $this->keys = ['publicKey' => $row->public_key, 'privateKey' => $row->private_key];
    }

    /**
     * The VAPID `sub` claim. Apple's push service (web.push.apple.com) rejects
     * anything that isn't an https: or mailto: URI, so a default APP_URL of
     * http://localhost:3500 silently kills all iOS delivery while FCM/Mozilla
     * accept it — a one-directional "works on Android, dead on iPhone" bug.
     * Prefer an explicit VAPID_SUBJECT, then a real https app URL, else mailto.
     */
    public function vapidSubject(): string
    {
        $configured = config('babylog.vapid_subject');
        if (is_string($configured) && trim($configured) !== '') {
            return trim($configured);
        }
        $url = (string) config('app.url');
        if (str_starts_with($url, 'https://')) {
            return $url;
        }

        return 'mailto:babylog@'.(parse_url($url, PHP_URL_HOST) ?: 'localhost');
    }

    private function client(): WebPush
    {
        return $this->client ??= new WebPush(
            ['VAPID' => [
                'subject' => $this->vapidSubject(),
                'publicKey' => $this->keys()['publicKey'],
                'privateKey' => $this->keys()['privateKey'],
            ]],
            [],
            new Client(['timeout' => 10]),
        );
    }
}
