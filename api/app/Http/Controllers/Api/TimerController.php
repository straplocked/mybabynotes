<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\TimerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The live nursing/pump/sleep timers. Only running state lives here — when a
 * timer stops, the client writes the resulting entry through the normal
 * outbox, so the log stays the single source of truth (the server stores facts,
 * not in-flight guesses). Timers stack; each start/stop names one by id.
 */
class TimerController extends Controller
{
    /** Start a timer. `id` is the client-generated id, entry-style. */
    public function start(Request $request, TimerService $timers): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', 'in:nurse,pump,sleep,tummy'],
            'baby_id' => ['nullable', 'integer'],
            'id' => ['sometimes', 'string', 'max:64'],
        ]);

        $timer = $timers->start(
            $request->user(),
            $data['type'],
            isset($data['baby_id']) ? (int) $data['baby_id'] : null,
            $data['id'] ?? null,
        );

        return response()->json(['ok' => true, 'timer' => $timer]);
    }

    /**
     * Stop one timer by id. The entry itself is logged client-side. No id is
     * the pre-multi-timer form: stops the caller's newest timer.
     */
    public function stop(Request $request, TimerService $timers): JsonResponse
    {
        $data = $request->validate([
            'id' => ['sometimes', 'string', 'max:64'],
        ]);

        $stopped = $timers->stop($request->user(), $data['id'] ?? null);

        return response()->json(['ok' => true, 'stopped' => $stopped]);
    }
}
