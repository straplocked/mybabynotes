<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Providers;

use App\Contracts\AccountProvisioner;
use App\Support\ApiScopes;
use Dedoc\Scramble\Scramble;
use Dedoc\Scramble\Support\Generator\OpenApi;
use Dedoc\Scramble\Support\Generator\SecurityScheme;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\PersonalAccessToken;
use Laravel\Sanctum\Sanctum;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // resolved at request time so config overrides win regardless of
        // provider registration order
        $this->app->bind(
            AccountProvisioner::class,
            fn ($app) => $app->make(config('babylog.account_provisioner')),
        );

        $this->app->bind(
            \App\Contracts\MqttConnectionFactory::class,
            \App\Services\Mqtt\PhpMqttConnectionFactory::class,
        );
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Two token kinds share this callback. First-party app tokens (always
        // named 'app', minted at login/register) slide: sanctum.expiration
        // counts from login, which would log a daily-use phone out every ~90
        // days, so a token stays live while its last use is inside the window
        // and only a genuinely idle device re-sees the login screen. (Sanctum
        // stamps last_used_at on every authenticated request.) Personal access
        // tokens (any other name) must NOT slide — $isValid combines the
        // created_at window with expires_at, and returning true here would
        // resurrect a PAT past its explicit expiry while it stays in use.
        Sanctum::authenticateAccessTokensUsing(function (PersonalAccessToken $token, bool $isValid) {
            if ($token->name !== 'app') {
                return $token->expires_at === null || $token->expires_at->isFuture();
            }
            if ($isValid) {
                return true;
            }
            $minutes = config('sanctum.expiration');

            return $minutes !== null && (bool) $token->last_used_at?->gt(now()->subMinutes($minutes));
        });

        // /api/v1 gets its own bucket: an integration hammering the public API
        // must not starve the PWA's inline throttle:120,1 budget (identical
        // inline signatures share a per-user bucket)
        RateLimiter::for('v1', fn (Request $request) => Limit::perMinute(120)->by($request->user()?->id ?: $request->ip()));

        // the committed docs/openapi.v1.json is generated from this config —
        // scope names in route middleware surface through this description
        Scramble::configure()->withDocumentTransformers(function (OpenApi $openApi) {
            $scheme = SecurityScheme::http('bearer');
            $scheme->description = 'Personal access token from Settings → API access. Scopes: '
                .collect(ApiScopes::SCOPES)->map(fn ($label, $key) => "`{$key}` ({$label})")->implode(', ').'.';
            $openApi->secure($scheme);
        });
    }
}
