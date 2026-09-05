<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Mcp\Tools;

use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Attributes\Description;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[IsReadOnly]
#[Description('List the children in this household, oldest first (the first is the primary child).')]
class ListChildren extends BabylogTool
{
    public function handle(Request $request): Response
    {
        if ($denied = $this->requireAbilities($request, 'children:read')) {
            return $denied;
        }

        return Response::json([
            'children' => $this->user($request)->household->children
                ->map(fn ($b) => [
                    'id' => $b->id,
                    'name' => $b->name,
                    'birthdate' => $b->birthdate,
                    'age_label' => $b->age_label,
                    'archived' => (bool) $b->archived,
                ])->all(),
        ]);
    }
}
