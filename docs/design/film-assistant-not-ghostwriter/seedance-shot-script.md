# Seedance shot script — "An assistant, not a ghostwriter." (43s, 9:16)

Per-beat generation prompts for Seedance + post-composite plan. Rule that keeps the spec's
"100% real product" promise: **generated footage supplies atmosphere and human presence
only; every readable screen is a real product capture composited in post.** Never let the
model render UI or text — it will hallucinate.

## Style bible (prepend to every prompt)

> Cinematic vertical 9:16 video, 35mm film look, shallow depth of field, soft natural
> grain, muted contemporary palette — warm amber for outdoor "life" scenes, cool blue-slate
> for the night home-office scenes. Quiet, unhurried pacing. No readable text anywhere in
> frame, no logos, no brand marks, no captions.

**Recurring character ("the runner")** — describe identically in every prompt that
includes her: *a woman in her early 30s, medium-dark skin, hair in a low bun, matte black
athletic top under an open teal running jacket, small silver earbuds.* (Cut-to-cut drift
is hidden by varied angles; if Seedance supports image-to-video reference frames, reuse a
still from the first accepted B1a take.)

**Negative prompt, all shots:** readable text, subtitles, watermarks, UI elements,
logos, distorted hands, extra fingers, celebrity likeness.

---

## Beat 1 — 0:00–0:05 · THE SPLIT · caption on the black bar: **"Your AI is the assistant."**

Generate the two halves as separate clips; build the split + black bar in the edit
(video models compose split-screens badly).

**B1a · life half (5s):**
> Handheld tracking shot at golden hour in a city park at dusk: the runner jogging at an
> easy pace toward camera on a tree-lined path, warm amber sun flaring low through
> leaves, relaxed expression, breath visible slightly in cool air, natural motion blur,
> intimate documentary feel. Her hands are empty — no phone anywhere in frame.

**B1b · work half (5s):**
> Slow push-in on a dim home office at night: an open laptop alone on a wooden desk, the
> empty chair angled as if someone just left, the screen's cool blue glow the only light
> source, faint reflections of moving light from the screen playing on the desk surface,
> dust motes drifting through the glow, still-life calm.

**Post:** stack as movie split with a hard black bar (~7% frame height) between; caption
centered on the bar. B1b's screen replaced with a real capture: Claude + intervu tools
scrolling a job board (shoot from the live product).

---

## Beat 2 — 0:05–0:09 · THE GLANCE · caption: **"You didn't have to be watching."**

**B2 (4s):**
> Close over-the-shoulder shot at dusk in the park: the runner, now walking to cool
> down, pulls her phone from her jacket pocket; the dark screen lights up in her hand; a
> soft focus rack from the blurred profile of her face to the phone; warm bokeh of park
> lights behind; intimate, unhurried.

**Post:** lock-screen composite — one notification banner, real product styling:
*"Found 4 roles that fit. All real, all still hiring."* Time the screen-light bloom to
the composite.

---

## Beat 3 — 0:09–0:13 · THE REPLY · caption: **"You decide."**

**B3 (4s):**
> Macro close-up of two hands holding a phone above a park bench, evening; the right
> thumb types briefly — three or four deliberate taps — then one decisive final tap;
> warm lamplight on the hands, background melted to bokeh; a small settling motion as
> the hands relax after sending.

**Post:** thread composite on the screen — she types **"apply to the Braze one"**, send.

---

## Beat 4 — 0:13–0:19 · THE WORK · caption: **"It does the typing."**

**B4 (6s):**
> The dim home office again, slightly closer than before: the laptop screen alive with
> gentle activity, its light shifting subtly across the desk, keys untouched, the chair
> still empty, the room otherwise motionless; a slow lateral dolly right; night, cool
> slate-blue palette, cinematic still-life with one living element — the screen.

**Post:** the entire laptop screen is a real capture: Claude receiving the message, intervu
tools firing (search · resume · fill), Chrome opening the actual ATS form, fields filling.
The MCP connector stays visible in the UI — never named in a caption.

---

## Beat 5 — 0:19–0:24 · THE PROOF · caption: **"From your resume. Nothing invented."**

**B5 (5s):**
> Extreme macro, warm desk-lamp light: a printed résumé page lying on a wooden desk,
> shallow focus finding one line of experience text (unreadable soft focus), the camera
> drifting slowly along the line, paper texture and ink visible, everything else in
> gentle blur.

**Post:** this is the film's signature graphic moment — mid-beat, match-cut from the
generated paper macro to a full-frame real capture: the resume line highlighted, then the
*same words* appearing in the live form field. The words must be legible and identical;
both sides are real product/real document captures.

---

## Beat 6 — 0:24–0:30 · THE WATCH · caption: **"Watch, if you want."**

**B6 (6s):**
> Medium shot, deep dusk: the runner sitting on a park bench, city lights starting to
> glow behind her, holding her phone at a comfortable angle, watching it with calm mild
> interest, the phone's cool glow mixing with warm ambient light on her face, one knee
> up, completely at ease; static camera, cinematic.

**Post:** phone screen = real v2 watch page capture — "live — following the field"
header, the crop gliding field to field as the agent types.

---

## Beat 7 — 0:30–0:35 · THE FIX · caption: **"Fix anything."**

**B7 (5s):**
> Close over-the-shoulder on the phone held in her hands, bench, dusk bokeh: her thumb
> reaches deliberately and taps once, pauses, then types briefly — small confident
> gestures; the light from the screen shifts as the interface responds; macro detail,
> shallow focus on the thumb.

**Post:** real v2 capture — the **take control** tap, one field corrected from the phone
keyboard, the agent resuming.

---

## Beat 8 — 0:35–0:39 · THE SEND · caption: **"Nothing goes out without you."**

**B8 (4s):**
> Tight shot of the phone in her hands at dusk; the thumb types one very short word and
> taps send; the hands lower the phone gently to her lap; at the top edge of frame the
> hint of a small satisfied exhale, day done; warm and cool light mixing; quiet ending
> energy.

**Post:** thread composite — *"Ready. Want me to send it?"* → she types **"send."**

---

## Beat 9 — 0:39–0:43 · CLOSE CARD (no generation — pure graphics)

Black frame, product typography:
**An assistant, not a ghostwriter.**
*It does the typing. You stay the author.*
wordmark, beat of silence, cut to black.

---

## Assembly notes

- Captions: exact lines above, composited in post, one consistent type treatment (white,
  the product's grotesk, lower third except beat 1's bar). Flat-truth voice — never
  animate them beyond a simple fade.
- Clip durations above sum to 43s inclusive of the split; generate a second or two of
  handle on every clip for the cut.
- Cut-downs per spec: ~15s social (B1, B3, B7, B8, B9), ~6s hero loop (B4→B6).
- Audio: unresolved decision — recommend a sparse ambient bed + soft UI ticks on the
  composites, no voiceover. Silent version required anyway for the landing autoplay.
- Continuity: same wardrobe phrasing in every runner prompt; regenerate any clip where
  Seedance drifts her appearance rather than accepting a mismatched take.
