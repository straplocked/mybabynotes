<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace Tests\Feature;

use App\Mail\PasswordResetLink;
use App\Models\PushSubscription;
use App\Models\User;
use App\Services\PushService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Server-side i18n: X-App-Lang localizes the request (validation + custom API
 * messages) and is remembered on users.lang; /push/subscribe stores a
 * per-device lang; PushService renders copy per subscription language; the
 * reset email follows the account's last-seen language.
 */
class LocaleTest extends TestCase
{
    use RefreshDatabase;

    private function register(string $name, string $email): string
    {
        return $this->postJson('/api/register', ['name' => $name, 'email' => $email, 'password' => 'password123'])->json('token');
    }

    private function authed(string $token, array $extra = []): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$token, ...$extra];
    }

    public function test_x_app_lang_localizes_validation_errors(): void
    {
        // missing email in Spanish — the vendored lang/es/validation.php answers
        $res = $this->postJson('/api/login', ['password' => 'x'], ['X-App-Lang' => 'es']);
        $res->assertStatus(422);
        $this->assertStringContainsString('obligatorio', $res->json('errors.email.0'));
    }

    public function test_x_app_lang_localizes_custom_api_messages(): void
    {
        $token = $this->register('Ben', 'ben@example.com');
        // asking to take over your own handoff — custom 422, translated
        $this->postJson('/api/shifts/request', [], $this->authed($token, ['X-App-Lang' => 'es']));
        $res = $this->postJson('/api/shifts/accept', ['plan' => []], $this->authed($token, ['X-App-Lang' => 'es']));
        $res->assertStatus(422);
        $this->assertNotSame('You asked for this handoff — someone else has to take it.', $res->json('message'));
        $this->assertNotSame('', trim((string) $res->json('message')));
    }

    public function test_header_is_remembered_as_the_accounts_last_seen_language(): void
    {
        $token = $this->register('Ben', 'ben@example.com');
        $this->getJson('/api/state', $this->authed($token, ['X-App-Lang' => 'fr']))->assertOk();
        $this->assertSame('fr', User::sole()->lang);

        // junk is ignored, never stored
        $this->getJson('/api/state', $this->authed($token, ['X-App-Lang' => 'xx']))->assertOk();
        $this->assertSame('fr', User::sole()->lang);
    }

    public function test_subscribe_stores_the_device_language(): void
    {
        $token = $this->register('Ben', 'ben@example.com');
        $this->postJson('/api/push/subscribe', [
            'endpoint' => 'https://push.example/dev-1',
            'keys' => ['p256dh' => 'pk', 'auth' => 'ak'],
            'tz' => 'Europe/Madrid',
            'lang' => 'es',
        ], $this->authed($token))->assertOk();
        $this->assertSame('es', PushSubscription::sole()->lang);

        // unsupported language is rejected by validation, not silently stored
        $this->postJson('/api/push/subscribe', [
            'endpoint' => 'https://push.example/dev-1',
            'keys' => ['p256dh' => 'pk', 'auth' => 'ak'],
            'lang' => 'xx',
        ], $this->authed($token))->assertStatus(422);
    }

    public function test_push_copy_renders_per_language_with_nested_params(): void
    {
        // plain string = data, untouched
        $this->assertSame('4 breastmilk · 3:15 PM', PushService::render('4 breastmilk · 3:15 PM', 'es'));

        // English renders the key with params
        $this->assertSame('Ben logged a bottle', PushService::render(
            [':name logged :type', ['name' => 'Ben', 'type' => ['a bottle']]], 'en',
        ));

        // Spanish translates both the sentence and the nested type label,
        // keeps the name as data, and leaves no placeholder behind
        $es = PushService::render([':name logged :type', ['name' => 'Ben', 'type' => ['a bottle']]], 'es');
        $this->assertStringContainsString('Ben', $es);
        $this->assertStringNotContainsString(':name', $es);
        $this->assertStringNotContainsString(':type', $es);
        $this->assertNotSame('Ben logged a bottle', $es);

        // a missing catalog falls back to English rather than blanking
        $this->assertSame('Meds time', PushService::render(['Meds time'], 'xx'));
    }

    public function test_every_supported_locale_ships_a_server_catalog(): void
    {
        foreach (config('babylog.locales') as $code) {
            if ($code === 'en') {
                continue; // English is the key itself
            }
            $file = base_path('lang/'.$code.'.json');
            $this->assertFileExists($file, $code);
            $data = json_decode((string) file_get_contents($file), true);
            $this->assertIsArray($data, $code);
            // spot-check a core push key is present and actually translated
            $this->assertArrayHasKey('Meds time', $data, $code);
            $this->assertFileExists(base_path('lang/'.$code.'/validation.php'), $code);
        }
    }

    public function test_reset_email_uses_the_accounts_language(): void
    {
        Mail::fake();
        config(['mail.mailers.smtp.host' => 'smtp.example.com', 'mail.default' => 'smtp']);

        $token = $this->register('Ben', 'ben@example.com');
        // Ben's device speaks Spanish — remembered on the account…
        $this->getJson('/api/state', $this->authed($token, ['X-App-Lang' => 'es']))->assertOk();

        // …and the (logged-out) reset email follows it
        $this->postJson('/api/forgot-password', ['email' => 'ben@example.com'])->assertOk();
        Mail::assertSent(PasswordResetLink::class, fn ($mail) => $mail->locale === 'es');
    }
}
