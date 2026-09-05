<?php

namespace App\Mcp\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Carbon;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[IsReadOnly]
#[Description('Totals for one day: feeds (bottle ounces, nursing count), pumping, diapers by kind, sleep minutes, tummy time minutes, baths, meds.')]
class GetDailySummary extends BabylogTool
{
    public function schema(JsonSchema $schema): array
    {
        return [
            'date' => $schema->string()->description('The day, YYYY-MM-DD (default today).'),
            'tz' => $schema->string()->description('IANA timezone for day boundaries (default: your notification timezone, else the server\'s).'),
            'baby_id' => $schema->integer()->description('Limit to one child (default: all).'),
        ];
    }

    public function handle(Request $request): Response
    {
        if ($denied = $this->requireAbilities($request, 'entries:read')) {
            return $denied;
        }

        $user = $this->user($request);
        $household = $user->household;
        $tz = $request->get('tz') ?: ($user->notifyPrefs()['tz'] ?: config('app.timezone'));

        try {
            $day = Carbon::parse($request->get('date') ?: 'today', $tz)->startOfDay();
        } catch (\Throwable) {
            return Response::error('date must be YYYY-MM-DD and tz a valid IANA timezone.');
        }

        $query = $household->entries()->where('deleted', false)
            ->where('t', '>=', $day->getTimestampMs())
            ->where('t', '<', $day->copy()->addDay()->getTimestampMs());

        if ($babyId = $request->get('baby_id')) {
            if (! $household->children()->whereKey((int) $babyId)->exists()) {
                return Response::error('That child isn’t in this household — call list_children for valid ids.');
            }
            $primaryId = $household->children()->orderBy('id')->value('id');
            $query->where(fn ($q) => (int) $babyId === $primaryId
                ? $q->where('baby_id', $babyId)->orWhereNull('baby_id')
                : $q->where('baby_id', $babyId));
        }

        $entries = $query->get(['type', 'detail']);
        // details carry extras ("4 breastmilk", "3 · 15m") — the amount leads
        $numeric = fn ($detail) => preg_match('/^([\d.]+)/', (string) $detail, $m) ? (float) $m[1] : 0.0;
        // sleep/tummy minutes: bare number (the timer format) or a "45m" token ("Nap · 45m")
        $minutes = fn ($detail) => is_numeric($detail) ? (int) $detail
            : (preg_match('/(\d+)\s*m\b/', (string) $detail, $m) ? (int) $m[1] : 0);

        $byType = $entries->groupBy('type');
        $count = fn (string $type) => $byType->get($type)?->count() ?? 0;
        $sum = fn (string $type) => round($byType->get($type)?->sum(fn ($e) => $numeric($e->detail)) ?? 0, 2);
        $mins = fn (string $type) => (int) ($byType->get($type)?->sum(fn ($e) => $minutes($e->detail)) ?? 0);

        return Response::json([
            'date' => $day->toDateString(),
            'timezone' => $tz,
            'feeds' => [
                'bottles' => $count('bottle'),
                'bottle_oz' => $sum('bottle'),
                'nursing_sessions' => $count('nurse'),
            ],
            'pumping' => ['sessions' => $count('pump'), 'oz' => $sum('pump')],
            'diapers' => [
                'wet' => $count('wet'),
                'dirty' => $count('dirty'),
                'both' => $count('both'),
                'total' => $count('wet') + $count('dirty') + $count('both'),
            ],
            'sleep' => ['sessions' => $count('sleep'), 'minutes' => $mins('sleep')],
            'tummy_time' => ['sessions' => $count('tummy'), 'minutes' => $mins('tummy')],
            'baths' => $count('bath'),
            'meds' => $count('meds'),
        ]);
    }
}
