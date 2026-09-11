<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        // withRouting takes one api: file; the public versioned surface gets
        // its own (same 'api' middleware group, or it loses JSON semantics)
        then: function () {
            Route::middleware('api')
                ->prefix('api/v1')
                ->group(base_path('routes/api_v1.php'));
        },
    )
    ->withBroadcasting(
        __DIR__.'/../routes/channels.php',
        // abilities:* — the household poke channel is for the PWA's own
        // login tokens; a personal access token can't subscribe (see the
        // matching guard on the unversioned group in routes/api.php)
        ['prefix' => 'api', 'middleware' => ['auth:sanctum', 'abilities:*']],
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // TLS terminates at the reverse proxy (nginx / NPM)
        $middleware->trustProxies(at: '*');

        // localize each request from the device's X-App-Lang header
        $middleware->api(append: \App\Http\Middleware\SetLocale::class);

        // Web Push sends happen after the response, never inside it — global
        // so /api, /api/v1 and /mcp producers all defer the same way
        $middleware->append(\App\Http\Middleware\SendPushAfterResponse::class);

        // API-only app: no login page exists. The framework default redirects
        // guests to route('login'), which throws RouteNotFoundException (a 500)
        // for header-less probes; null lets the 401 render as JSON instead.
        $middleware->redirectGuestsTo(fn () => null);

        // Sanctum token scopes for the public API and MCP; first-party app
        // tokens carry ['*'] so these are no-ops for the PWA
        $middleware->alias([
            'abilities' => \Laravel\Sanctum\Http\Middleware\CheckAbilities::class,
            'ability' => \Laravel\Sanctum\Http\Middleware\CheckForAnyAbility::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->is('mcp') || $request->expectsJson(),
        );
    })->create();
