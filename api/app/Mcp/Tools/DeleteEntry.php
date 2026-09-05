<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Mcp\Tools;

use App\Services\EntryWriter;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;

#[IsDestructive]
#[Description('Delete one entry by id. Deletes are tombstones — the entry syncs as deleted to every device but the row is kept.')]
class DeleteEntry extends BabylogTool
{
    public function schema(JsonSchema $schema): array
    {
        return [
            'id' => $schema->string()->description('The entry id (from list_entries).')->required(),
        ];
    }

    public function handle(Request $request): Response
    {
        if ($denied = $this->requireAbilities($request, 'entries:write')) {
            return $denied;
        }

        $entry = app(EntryWriter::class)->tombstone($this->user($request), (string) $request->get('id'));
        if (! $entry) {
            return Response::error('No entry with that id in this household.');
        }

        return Response::json(['deleted' => $entry->id]);
    }
}
