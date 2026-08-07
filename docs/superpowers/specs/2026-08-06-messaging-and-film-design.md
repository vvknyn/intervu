# Messaging + film — "An assistant, not a ghostwriter."

**Date:** 2026-08-06
**Status:** design approved (iterated live with Vivek, Aug 6 00:42–01:05 EDT), production not started
**Owner:** Vivek
**Depends on:** viewer v2 (`2026-08-06-phone-viewer-v2-design.md`) — beats 6–7 of the film show take-control, which ships with v2.

## The wound this answers

AI autofill tools pad applications — skills the candidate doesn't have, answers they never
gave — and interviewers catch it. That story (told first-hand during this design session)
is the product's reason for existing and the message's center of gravity. On any public
surface it is always rendered second-person or universal ("interviewers ask about the
skills autofill padded in"), never as a founder anecdote.

Three consequences, in priority order:

1. **The AI is the assistant.** MCP and OpenClaw are tools that speed up the mundane work —
   never the headline, never the hero vocabulary.
2. **The human decides.** Review and the actual application decision are human-in-the-loop,
   always.
3. **It cannot invent you.** It works only from the real resume and real answers; that is
   what makes 1 and 2 safe to enjoy.

## Voice

**Flat truth, anti-marketing.** Chosen over Apple-minimal and product-voice in an explicit
voice test, after a full round of conventional two-beat SaaS copy was rejected wholesale.

Rules:
- Declarative sentences. No exclamation, no adrenaline, no ad-speak imperatives commanding
  the reader ("Stop applying!"). Permissive invitations are fine — "Watch, if you want."
  is in-voice; "Don't miss out" never is.
- Job-seeker plain language. "MCP" never appears in a caption or headline; Claude and the
  connector appear **visually, in the product UI**, where the AI-native crowd recognizes
  them on sight and nobody else needs to.
- Every claim must be product-true (no-invention rules, never-submit gate, live viewer,
  verified-real listings). If engineering can't back the sentence, the sentence goes.

## The hero

> ## An assistant, not a ghostwriter.
> ### It does the typing. You stay the author.
>
> It finds real openings and fills the forms from your resume — nothing invented, ever.
> Watch it work live from your phone, change anything, and nothing goes out until you
> press send.

Converged from two survivors of round 3 (heading from "An assistant, not a ghostwriter",
subheading from "It does the typing. You stay the author") — the ghostwriter/author rhyme
is the lockup's engine. The paragraph compresses the spine's three beats.

## The spine (all surfaces, this order)

1. **It can't invent you.** Only your real resume and your real answers — nothing padded,
   nothing imagined.
2. **You decide.** See every application — live on your phone if you want — fix anything,
   and nothing sends until you say so.
3. **It clears the mundane.** Finding real openings, retyping your history into yet another
   form — that part's over.

## The film (~43s, 9:16 vertical master)

**Craft rule discovered in mockup iteration (binding for production):** in the opening
split, the life panel contains **no screen of any kind**. Two panels that both hold screens
on the same topic read as "connected devices" no matter what divides them; a person living
(no phone) beside an empty room where a laptop types alone reads as "meanwhile." The
phone↔laptop link is then *built deliberately* across beats 3→4 (reply causes work) so
that watching in beat 6 arrives earned, opt-in, unconfusing.

| # | Time | On screen | Caption |
|---|---|---|---|
| 1 | 0–5s | Movie split, black bar: park at dusk, person jogging, no phone in frame / empty room, laptop reading job boards alone. Caption sits on the bar. | **Your AI is the assistant.** |
| 2 | 5–9s | Full frame: phone buzzes. "Found 4 roles that fit. All real, all still hiring." A glance. | **You didn't have to be watching.** |
| 3 | 9–13s | Thumb replies: "apply to the Braze one." From a park bench. | **You decide.** |
| 4 | 13–19s | Empty room: Claude receives it, intervu tools fire (search · resume · fill), Chrome opens the real form, fields fill. MCP visible in UI only. | **It does the typing.** |
| 5 | 19–24s | Proof shot: a real resume line highlighted → the same words landing in the form field. | **From your resume. Nothing invented.** |
| 6 | 24–30s | The person, seated: watch page live on the phone, crop gliding field to field. | **Watch, if you want.** |
| 7 | 30–35s | Thumb taps take control, fixes one field, the agent carries on. | **Fix anything.** |
| 8 | 35–39s | Thread: "Ready. Want me to send it?" → "send." | **Nothing goes out without you.** |
| 9 | 39–43s | Black close card, two lines, wordmark. | **An assistant, not a ghostwriter.** / *It does the typing. You stay the author.* |

**Cut-downs from the same master:** ~15s social clip (beats 1, 3, 7, 8, 9) for
X/Substack; ~6s silent hero loop (beats 4→6).

**Production sources per beat:**
- Beats 2/3/8: the WhatsApp-thread renderer (`b-openclaw` pipeline, `WhatsAppThreadHero`
  family).
- Beat 4: screen capture of Claude with the intervu connector (existing
  `video-a-mcp.mp4` may yield footage) + real agent run in Chrome via the frame-exact
  Playwright pipeline.
- Beat 5: staged capture — resume PDF + the same field in the live form.
- Beats 6/7: the real watch page — **requires viewer v2 merged and deployed first.**
- Beats 1/6/7 ambience (park, hands, bench): stock or device-frame-over-ambient
  composites; no faces needed, keeps it anonymous and cheap.

## Where the words land (deliverables, not yet implemented)

| Surface | Change |
|---|---|
| Landing hero | Hero lockup replaces current hero copy; composition/design pass is its own task and follows the design-language spec (#119) |
| Landing sections | Sections re-ordered to spine order: can't-invent-you (with the padded-skills wound, second person) → you-decide (viewer moment) → clears-the-mundane |
| `/connect` | Keeps agent-native vocabulary but opens with the same hero sub-line |
| Films row | Vertical master leads the row, ahead of `video-a` / `video-b`; phone-frame mount for the landscape row |
| Close card / OG copy | The lockup, verbatim |

## Out of scope

Distribution posts themselves (X/Substack/Reddit — separate, channel-checked work) ·
landing redesign mechanics · producing the film before viewer v2 ships · any paid asset.

## Success criteria

- Someone who has been burnt by autofill reads the hero and knows this product is the
  answer to *that*, within one screen, without one acronym.
- The film is 100% real product on screen; nothing staged that the product can't do.
- Every caption survives the read-aloud test in the flat-truth voice.
