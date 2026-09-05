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

/** "Your partner saved you a seat" — carries the single-use invite code. */
class PartnerInvite extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public string $inviterName,
        public ?string $babyName,
        public string $code,
        public string $url,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            from: new Address(config('mail.from.address'), 'mybabynotes'),
            subject: $this->inviterName.' saved you a seat on mybabynotes',
        );
    }

    public function content(): Content
    {
        return new Content(text: 'mail.invite');
    }
}
