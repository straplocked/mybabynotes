<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Mcp\Tools;

use App\Services\EntryWriter;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Carbon;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;

#[Description('Edit one entry by id. Only the fields you pass change; the original author is preserved.')]
class UpdateEntry extends BabylogTool
{
    public function schema(JsonSchema $schema): array
    {
        return [
            'id' => $schema->string()->description('The entry id (from list_entries).')->required(),
            'type' => $schema->string()->enum(['bottle', 'nurse', 'pump', 'wet', 'dirty', 'both', 'sleep', 'tummy', 'bath', 'meds']),
            'time' => $schema->string()->description('New time, ISO 8601.'),
            'detail' => $schema->string()->max(100)->nullable(),
            'baby_id' => $schema->integer()->description('Re-home the entry to this child (omit to keep).'),
        ];
    }

    public function handle(Request $request): Response
    {
        if ($denied = $this->requireAbilities($request, 'entries:write')) {
            return $denied;
        }

        $user = $this->user($request);
        $fields = [];
        if ($request->get('type') !== null) {
            $fields['type'] = (string) $request->get('type');
        }
        if ($request->get('time') !== null) {
            try {
                $fields['t'] = Carbon::parse($request->get('time'))->getTimestampMs();
            } catch (\Throwable) {
                return Response::error('time must be an ISO 8601 timestamp.');
            }
        }
        if (array_key_exists('detail', $request->all())) {
            $fields['detail'] = $request->get('detail') !== null ? (string) $request->get('detail') : null;
        }
        if ($request->get('baby_id') !== null) {
            $fields['baby_id'] = (int) $request->get('baby_id');
        }

        $entry = app(EntryWriter::class)->update($user, (string) $request->get('id'), $fields);
        if (! $entry) {
            return Response::error('No entry with that id in this household.');
        }

        $primary = $user->household->children()->orderBy('id')->value('id');

        return Response::json(['updated' => $this->entryArray($entry, $primary, $this->memberNames($user))]);
    }
}
