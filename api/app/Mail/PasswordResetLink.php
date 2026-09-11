<?php

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Address;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Password reset link pointing at the SPA: <app-url>/#reset=<token>&email=<email>.
 *
 * The token rides the URL *fragment*, not the query string: browsers never send
 * the fragment over the wire, so it stays out of nginx access logs, proxy logs,
 * and Referer headers. The SPA reads it on boot (App.jsx also still accepts the
 * legacy ?reset= form for links already sitting in inboxes) and scrubs it from
 * history straight away.
 */
class PasswordResetLink extends Mailable
{
    use Queueable, SerializesModels;

    public string $url;

    public function __construct(
        public string $name,
        public string $email,
        public string $token,
    ) {
        $this->url = rtrim((string) config('app.url'), '/').'/#reset='.$token.'&email='.urlencode($email);
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            from: new Address(config('mail.from.address'), 'mybabynotes'),
            subject: __('Reset your mybabynotes password'),
        );
    }

    public function content(): Content
    {
        return new Content(text: 'mail.reset');
    }
}
