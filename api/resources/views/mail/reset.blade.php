{{-- plain-text mail (Content(text:)): {!! !!} on purpose — {{ }} would HTML-escape the link (& → &amp;) and the copy (’ → &#039;) --}}
{!! __('Hi :name,', ['name' => $name]) !!}

{!! __('Someone asked to reset the password for your mybabynotes account. If that was you, set a new one here — the link is good for about an hour:') !!}

  {!! $url !!}

{!! __("If it wasn't you, you can ignore this and your password stays put.") !!}

— mybabynotes
