<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Services;

use App\Models\User;
use GuzzleHttp\Client;
use GuzzleHttp\ClientInterface;
use Illuminate\Support\Facades\DB;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\VAPID;
use Minishlink\WebPush\WebPush;
use Psr\Log\LoggerInterface;

/**
 * Web Push transport. Like HouseholdTouched, delivery is best-effort — a dead
 * push service must never fail the write (or the scheduler tick) that asked
 * for it. Whether a notification *should* go out is the caller's job; this
 * class only ships it to every device the user opted in.
 *
 * Timing: inside an HTTP request (SendPushAfterResponse flips the service
 * into deferred mode) notify() only buffers, and flush() runs from the
 * kernel's terminate phase — after the response has been sent — so a slow or
 * hostile push endpoint can't hold the partner's write. Console commands
 * (babylog:reminders) send inline; nothing is waiting on them.
 *
 * Budget: 5s per endpoint (connect 3s) and 15s for one flush, whichever is
 * hit first. A flush still occupies a php-fpm worker even though the client
 * has its answer, so this caps how long one write can tie up the pool; a
 * household has a handful of devices, so a healthy send never nears it.
 */
class PushService
{
    public const ENDPOINT_TIMEOUT_SECONDS = 5;

    public const FLUSH_BUDGET_SECONDS = 15;

    private ?WebPush $client = null;

    private ?array $keys = null;

    private bool $deferred = false;

    /** @var list<array{0: User, 1: string, 2: string|array, 3: string|array}> */
    private array $pending = [];

    /** @param ClientInterface|null $http override the transport (tests hand in a mock handler) */
    public function __construct(private ?ClientInterface $http = null) {}

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
        if ($this->deferred) {
            $this->pending[] = [$user, $tag, $title, $body];

            return;
        }
        $this->deliver($user, $tag, $title, $body, microtime(true) + self::FLUSH_BUDGET_SECONDS);
    }

    /** From here on, notify() buffers until flush() — the HTTP request lifecycle. */
    public function deferUntilTerminate(): void
    {
        $this->deferred = true;
    }

    /** Ship everything buffered by notify(), inside one time budget. */
    public function flush(): void
    {
        $deadline = microtime(true) + self::FLUSH_BUDGET_SECONDS;
        while (($next = array_shift($this->pending)) !== null) {
            $this->deliver(...$next, deadline: $deadline);
        }
    }

    private function deliver(User $user, string $tag, string|array $title, string|array $body, float $deadline): void
    {
        try {
            $subs = $user->pushSubscriptions;
            if ($subs->isEmpty()) {
                return;
            }
            foreach ($subs as $sub) {
                if (microtime(true) >= $deadline) {
                    return; // over budget — the app still converges through sync
                }
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
            $this->http ?? new Client([
                'timeout' => self::ENDPOINT_TIMEOUT_SECONDS,
                'connect_timeout' => 3,
            ]),
            // with a logger the library's "install GMP/BCMath" advice is a log
            // line; without one it's an E_USER_NOTICE, which Laravel's error
            // handler turns into an exception — no pushes at all on an image
            // without the extension, silently
            logger: app(LoggerInterface::class),
        );
    }
}
