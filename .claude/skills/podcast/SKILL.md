---
name: podcast
description: Use when the user wants a new episode of the NOSTRAS podcast ("make this week's podcast", "record an episode", "podcast about what we shipped"). Builds a weekly, manually-triggered spoken episode from this project's real dated history in CLAUDE.md (never invented facts), writes a script for the ear, synthesizes it with Gemini TTS (Sulafat voice, gemini-tts.sh), uploads the audio to Blossom with the skill's own throwaway uploader key, and hands the user a ready-to-review package for both NOSTRAS's Podcast composer (kind:54, NIP-F4) and a plain kind:1 note. Never publishes the episode itself.
---

# The NOSTRAS podcast — a weekly episode telling this project's real story

A weekly (manually-triggered, not scheduled) episode narrating what's
actually happened on NOSTRAS — sourced from this project's own real,
accumulated history (`CLAUDE.md`'s dated entries, same sourcing
discipline as `/build-in-public`), turned into a real spoken-word
script, synthesized into real audio via the Gemini TTS API (the Sulafat
voice, chosen 2026-09-06 by listening to real generated samples against
three other candidates — see `gemini-tts.sh`), uploaded to Blossom, and
handed to the user as a ready-to-review package for **both** NOSTRAS's
own real Podcast composer (Compose → Podcast, kind:54/NIP-F4) **and** a
plain kind:1 note (see step 5) — the latter exists because kind:54 is a
NOSTRAS-exclusive format no other Nostr client renders, so it's
currently invisible to anyone not already using NOSTRAS; the plain-note
version is a real workaround for that, not a lesser afterthought, until
NOSTRAS has enough real reach that kind:54-only distribution stops being
a liability.

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

- `NOSTRAS_GEMINI_API_KEY` in the project root's `.nostras.env` — a real
  Gemini API key (Google AI Studio), same shared-secrets convention as
  `NOSTRAS_ANTHROPIC_API_KEY`/`NOSTRAS_DVM_NWC_URI`. Never typed into
  chat or read by Claude directly; the user sets it themselves.
- `gemini-tts.sh <voice-name> <output-wav-path> [model]` — calls the
  Gemini TTS API (`generateContent` with `responseModalities:["AUDIO"]`,
  `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`), reads the
  text to speak from stdin. Returns raw 16-bit PCM at 24kHz mono
  (confirmed live via the response's own `mimeType` field, not assumed),
  wrapped into a real WAV via `sox -t raw -r 24000 -e signed -b 16 -c 1`.
  Defaults to `gemini-2.5-flash-preview-tts`; a `pro` variant of the same
  model exists if quality ever needs to go up.
- **Voice: `Sulafat`** (*Warm*, per Gemini's own style descriptor) —
  chosen 2026-09-06 by generating real ~20s samples in four candidates
  (Charon/Informative, Sulafat/Warm, Sadaltager/Knowledgeable,
  Achird/Friendly) from an actual Episode 1 excerpt and having the user
  listen and pick, not chosen from text descriptors alone. Prefix the
  text sent to `gemini-tts.sh` with a real style instruction every time
  (e.g. `"Say this in a natural, warm, informative podcast-host tone,
  conversational pacing, not rushed: <script text>"`) — this is what
  Piper's flat neural voice couldn't do at all, and is the entire reason
  this project moved off it.
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
printf 'Say this in a natural, warm, informative podcast-host tone, conversational pacing, not rushed: %s' "$SCRIPT_TEXT" \
  | ./gemini-tts.sh Sulafat scratch/episode.wav
sox scratch/episode.wav scratch/episode.mp3
```

Verify before trusting it, the same discipline this project applies
everywhere else — don't assume a zero exit code means real audio:

```
soxi scratch/episode.wav | grep Duration
```

Sanity-check the duration against the script's own word count at natural
reading pace (~150-200 wpm) — confirmed live for a real 632-word episode
that a single `generateContent` call renders the *entire* script with no
truncation (3:05 actual vs. ~3.1min expected), so a duration wildly off
from that estimate means something genuinely went wrong (an API error
swallowed silently, a stray character breaking the request), not a
per-call length limit to route around.

## 4. Upload to Blossom

```
./upload-to-blossom.sh scratch/episode.mp3 audio/mpeg
```

Confirm the resulting URL is genuinely reachable and serves real audio
before handing it to the user — `curl -sL -o /dev/null -w "%{http_code}
%{size_download}\n" <url>` should show `200` and a real byte count
matching the local file, not just trust the upload call's own "success."

## 5. Hand off the finished package — never publish it yourself

Present **two** ready-to-use outputs, both for the user to paste and
publish themselves — never imply either is already live:

**A. NOSTRAS's own Compose → Podcast tab** (kind:54/NIP-F4) — the
real, structured version, worth keeping even though it's currently
NOSTRAS-only:
- **Episode title** (e.g. "NOSTRAS Podcast #1 — Own Your Keys, Own Your
  Voice, Own Your Money" for episode 1; "NOSTRAS Weekly #N — <one real
  highlight>" pattern for later ones)
- **Brief description** (one to two sentences, shown in the feed)
- **Audio URL** (the real Blossom URL from step 4)
- **Full show notes** (markdown — this can be richer than the spoken
  script: real links, real NIP numbers, real technical detail the audio
  itself simplified for listenability)

**B. A plain kind:1 note** (paste straight into the regular Composer) —
**the real distribution workaround, added 2026-09-06 at the user's own
request**, since kind:54 doesn't render in any other Nostr client and a
podcast nobody outside NOSTRAS can even see isn't reaching anyone.
NOSTRAS's own `parseContent.ts` (and most other clients' equivalent
extension-sniffing) renders a plain `.mp3` URL in note content as a real
inline `<audio>` player, no NIP-92 `imeta` tag or special kind required
— so the same real Blossom URL from step 4, dropped into an ordinary
note, plays back almost everywhere on the network, not just in NOSTRAS.
Compose this as: the episode title as a short opening line, the brief
description (not the full markdown show notes — this is a note, not an
article), then the bare audio URL on its own line so it's unambiguous
to any client's extension-sniffing. Explicitly temporary, not a
replacement for A — re-evaluate once NOSTRAS has enough real reach that
kind:54 alone would actually work.

If the user wants a companion announcement note/thread beyond this
(cross-posted to other platforms via `/distribute`, for instance),
that's a separate, explicit ask — this skill's job ends at handing off
A and B.

## 6. Log it

A one-line note in `nostr-client-node-strategy.md`'s Content log once
the user confirms it's actually published (episode number, title, real
Blossom URL, which of A/B were actually posted, one sentence on what the
episode covered) — same verify-before-logging discipline as everywhere
else in this project. Don't log it as done until the user has actually
confirmed the publish.
