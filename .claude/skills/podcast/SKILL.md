# The NOSTRAS podcast — a weekly episode telling this project's real story

A weekly (manually-triggered, not scheduled) episode narrating what's
actually happened on NOSTRAS — sourced from this project's own real,
accumulated history (`CLAUDE.md`'s dated entries, same sourcing
discipline as `/build-in-public`), turned into a real spoken-word
script, synthesized into real audio with a local TTS engine (no
external API, no per-episode cost), uploaded to Blossom, and handed to
the user as a ready-to-review package for NOSTRAS's own real Podcast
composer (Compose → Podcast, kind:54/NIP-F4).

**Never publishes anything itself.** Same standing rule as every other
publish-shaped action in this project — this skill prepares an episode
(script, audio file, show notes) and hands it to the user to paste into
the composer and click "Publish episode" themselves. The one exception
is the Blossom upload itself, which is a technical prerequisite (Blossom
just serves files by hash — uploading isn't publishing, and it uses this
skill's own dedicated, zero-reputation uploader key, never the user's
real identity).

## 0. One-time setup (already done for this project, described here for
reference / recovery)

- `venv/` — a dedicated Python virtualenv with `piper-tts` installed
  (`python3 -m venv venv && venv/bin/pip install piper-tts`). Gitignored
  — machine-local, not something to commit or expect to survive a fresh
  checkout.
- `voices/en_US-lessac-medium.onnx` (+ `.onnx.json`) — a real neural TTS
  voice model, downloaded once via
  `venv/bin/python -m piper.download_voices --download-dir voices
  en_US-lessac-medium`. Gitignored (63MB, a binary model file, not
  source).
- `uploader-key.txt` — a dedicated, purpose-built Nostr keypair used
  *only* to sign Blossom upload-authorization events (BUD-11 kind
  24242). Zero real value or reputation attached — a technical utility
  key, not a real identity, and never used to sign or publish anything
  else. Gitignored (it's a secret, however low-stakes). Generate a fresh
  one with `nak key generate` if this file is ever missing.
- `upload-to-blossom.sh <file> <content-type>` — uploads to
  `blossom.primal.net` using the exact BUD-11 flow already proven
  correct in `client/src/lib/blossom.ts` (standard base64 *with*
  padding for the Authorization header — this server rejects the
  spec's literal base64url-without-padding, confirmed by this
  project's own prior real testing, not assumed here). Prints the
  resulting public URL on success.

If any of these are missing when the skill runs, recreate them following
the commands above rather than guessing — this is exactly the kind of
thing worth getting right once and documenting, not re-deriving from
memory each time.

## 1. Gather real source material — never invent a single fact

**Episode 1** ("the announcement"): read `CLAUDE.md` broadly — the
Project/Status sections at the top, plus a representative arc across its
dated entries — and draft a genuine origin-story overview: what NOSTRAS
is, why it exists (the "Own Your Keys, Own Your Voice, Own Your Money"
mantra, made real — not just a slogan, actual shipped features behind
each clause), and a few real, well-chosen highlights (not an exhaustive
catalog) that give a new listener a true sense of what's been built and
how. This is the show's introduction, not a changelog.

**Every subsequent episode**: scan `CLAUDE.md`'s dated entries for
roughly the last 7 days (same date-scoped-real-history approach
`/engage`'s own step 1 already uses elsewhere in this project) and turn
that into "here's what actually happened this week." A quiet week is a
real, honest episode too ("not much shipped this week, here's what we're
mid-way through") — never pad a thin week with invented content just to
fill runtime, matching this project's own standing "a quiet round is a
real, expected outcome" ethos already established in `/engage`.

Cross-check anything genuinely uncertain against `NOSTRAS-CSV.md` (the
IQ/OQ/PQ log — useful for precise incident/fix framing) or
`nostr-client-node-strategy.md`'s Decisions/Content/Engagement logs
(useful for the "why," not just the "what") rather than guessing.

## 2. Draft a real spoken-word script — write for the ear, not the page

The single most important quality bar: this has to sound like natural
speech when read aloud by a TTS engine, not like a bulleted changelog
being read verbatim. Concretely:

- Short, natural sentences. No parenthetical asides, no inline code
  formatting, no markdown — TTS reads all of that literally and badly.
- Spell out anything a listener needs to *hear* correctly: numbers,
  acronyms on first use ("NIP, that's Nostr Implementation Possibility,
  ninety" not "NIP-90"), URLs only if truly necessary (better: describe
  where to find something, "search nostras dot app" reads fine, a raw
  path does not).
- A real intro (who/what the show is, for episode 1; a one-line
  "welcome back" for later ones) and a real outro (where to find
  NOSTRAS, an invitation to follow/reply) — a podcast has a shape, not
  just content poured in.
- Target roughly 3-6 minutes of spoken audio for a weekly episode
  (~450-900 words at natural pacing) unless the week's real content
  genuinely warrants more — don't pad, but don't force-compress a
  genuinely eventful week either.

**Show this script to the user for review before synthesizing anything.**
Regenerating audio after a script edit is cheap with local TTS — this is
a real, worthwhile checkpoint, not bureaucracy. Get explicit approval
(or edits) before moving to step 3.

## 3. Synthesize the audio

```
cd .claude/skills/podcast
printf '%s' "$SCRIPT_TEXT" | venv/bin/piper -m voices/en_US-lessac-medium.onnx -f scratch/episode.wav
sox scratch/episode.wav scratch/episode.mp3
```

Verify before trusting it, the same discipline this project applies
everywhere else — don't assume a zero exit code means real audio:

```
python3 -c "
import wave
w = wave.open('scratch/episode.wav', 'rb')
print('duration_s:', w.getnframes()/w.getframerate())
"
```

A duration wildly shorter than the script's expected reading time (or
zero) means something truncated silently — re-check the script text for
stray characters piper's tokenizer choked on, don't just re-run and hope.

## 4. Upload to Blossom

```
./upload-to-blossom.sh scratch/episode.mp3 audio/mpeg
```

Confirm the resulting URL is genuinely reachable and serves real audio
before handing it to the user — `curl -sL -o /dev/null -w "%{http_code}
%{size_download}\n" <url>` should show `200` and a real byte count
matching the local file, not just trust the upload call's own "success."

## 5. Hand off the finished package — never publish it yourself

Present, for the user to paste into NOSTRAS's own Compose → Podcast tab
and publish themselves:

- **Episode title** (e.g. "NOSTRAS Podcast #1 — Own Your Keys, Own Your
  Voice, Own Your Money" for episode 1; "NOSTRAS Weekly #N — <one real
  highlight>" pattern for later ones)
- **Brief description** (one to two sentences, shown in the feed)
- **Audio URL** (the real Blossom URL from step 4)
- **Full show notes** (markdown — this can be richer than the spoken
  script: real links, real NIP numbers, real technical detail the audio
  itself simplified for listenability)

Say plainly that this is ready to review and publish — never imply it's
already live. If the user wants a companion announcement note/thread
cross-posted alongside the episode, that's a separate, explicit ask
(this skill's job ends at hand-off), not something to draft
unprompted.

## 6. Log it

A one-line note in `nostr-client-node-strategy.md`'s Content log once
the user confirms it's actually published (episode number, title, real
Blossom URL, one sentence on what the episode covered) — same
verify-before-logging discipline as everywhere else in this project.
Don't log it as done until the user has actually confirmed the publish.
