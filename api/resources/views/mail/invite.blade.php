{{-- plain-text mail (Content(text:)): {!! !!} on purpose — {{ }} would HTML-escape the link (& → &amp;) and the copy (’ → &#039;) --}}
{!! __('Hi,') !!}

{!! $babyName ? __(':name set up a shared baby log for :baby and saved you a seat.', ['name' => $inviterName, 'baby' => $babyName]) : __(':name set up a shared baby log and saved you a seat.', ['name' => $inviterName]) !!}
{!! __('Three taps, then back to the baby — both of you, one log.') !!}

{!! __('Sign up with this email address here:') !!}

  {!! $url !!}

{!! __('Your invite code: :code', ['code' => $code]) !!}

{!! __('The code works once, and only for this address. Not expecting this? Just ignore it.') !!}

— mybabynotes
