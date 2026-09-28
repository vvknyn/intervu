import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normaliseLocation,
  placeHasSegment,
  stripPlaceSegment,
} from "../../src/lib/presentation/location-normalise";
import { locationSummary } from "../../src/lib/presentation/location";
import { locationText, locationWithMode, placeWithWorkMode } from "../../src/lib/jobs/presentation";
import type { PublicJob } from "../../src/lib/jobs/types";

const job = (over: Partial<PublicJob>): PublicJob =>
  ({ location: null, location_city: null, location_state: null, location_country: null, work_type: null, ...over }) as PublicJob;

/** The QA-reported defect: adjacent repeated word inside one label. */
const REPEATED_ADJACENT = /\b(\w+)\s*\1\b/i;

// --- normaliseLocation: the shapes that must change ------------------------

test("QA string: glued RemoteRemote + ATS filler + All States collapses to Remote", () => {
  assert.equal(normaliseLocation("RemoteRemote Location, All States"), "Remote");
});

test("the doubled label never regrows the work mode once normalised", () => {
  const place = locationText(job({ location: "RemoteRemote Location, All States", work_type: "remote" }));
  assert.equal(place, "Remote");
  assert.equal(placeWithWorkMode(place, "remote"), "Remote");
  // Even handed the raw dirty string, the fold-in normalises first.
  assert.equal(placeWithWorkMode("RemoteRemote Location, All States", "remote"), "Remote");
});

test("'Remote Location' / 'Remote City' filler is stripped by pattern, keeping the real place", () => {
  assert.equal(normaliseLocation("Remote Location, Canada"), "Remote, Canada");
  assert.equal(normaliseLocation("Remote City; Toronto, ON"), "Remote; Toronto, ON");
  assert.equal(normaliseLocation("Remote Office"), "Remote");
});

test("'Remote Remote' (spaced) collapses to one Remote", () => {
  assert.equal(normaliseLocation("Remote Remote"), "Remote");
  assert.equal(normaliseLocation("Canada · Remote · Remote"), "Canada · Remote");
});

test("token containment: Remote is dropped from 'Remote Canada' within one entry", () => {
  assert.equal(normaliseLocation("Remote, Remote Canada"), "Remote Canada");
});

test("placeholder-only segments ('All States', 'Location') are dropped; nothing real left -> empty", () => {
  assert.equal(normaliseLocation("Austin, TX, All States"), "Austin, TX");
  assert.equal(normaliseLocation("All States"), "");
  assert.equal(normaliseLocation("Location"), "");
});

test("Pitney site codes: 'US CT Shelton; US FL Remote; …' becomes readable places", () => {
  assert.equal(
    normaliseLocation("US CT Shelton; US FL Remote; US NY Remote"),
    "Shelton, CT; Remote - FL; Remote - NY",
  );
  // A 2nd token that is not a state/province code is left alone.
  assert.equal(normaliseLocation("US ZZ Somewhere"), "US ZZ Somewhere");
});

test("Pitney list through the card summary is capped, first place leads", () => {
  assert.equal(
    locationSummary("US CT Shelton; US FL Remote; US NY Remote; US TX Remote; US CA Remote"),
    "Shelton, CT +4 more",
  );
});

test("Pitney list of ONLY remote states still collapses to Remote (US) via the site-code rewrite", () => {
  assert.equal(locationSummary("US FL Remote; US NY Remote; US TX Remote"), "Remote (US)");
});

test("Adobe 'San Jose; San Francisco' stays a real two-place list; duplicates in it collapse", () => {
  assert.equal(normaliseLocation("San Jose; San Francisco"), "San Jose; San Francisco");
  assert.equal(locationSummary("San Jose; San Francisco"), "San Jose; San Francisco");
  assert.equal(normaliseLocation("San Jose; San Francisco; San Jose"), "San Jose; San Francisco");
  assert.equal(locationSummary("San Jose; San Francisco; Austin; Seattle"), "San Jose +3 more");
});

test("summary runs the same normaliser: QA string reads 'Remote' on the card path too", () => {
  assert.equal(locationSummary("RemoteRemote Location, All States"), "Remote");
});

// --- must NOT change --------------------------------------------------------

test("real places, separators and multi-location lists are left byte-identical", () => {
  for (const s of [
    "Toronto, Canada",
    "Remote - EMEA",
    "Canada · Remote",
    "Remote Canada; Remote USA",
    "Winston-Salem, NC",
    "Walla Walla, WA", // real reduplicated place: not a work-mode word, has a space
    "Bora Bora",
    "Kansas City, MO",
    "Location not listed",
  ]) {
    assert.equal(normaliseLocation(s), s, s);
  }
});

test("locationWithMode/placeWithWorkMode: onsite/hybrid still append, remote-with-remote does not", () => {
  assert.equal(locationWithMode("Toronto, Ontario", "hybrid"), "Toronto, Ontario · Hybrid");
  assert.equal(placeWithWorkMode("Milan, Italy", "remote"), "Milan, Italy · Remote");
  assert.equal(placeWithWorkMode("Remote Location", "remote"), "Remote");
  assert.equal(locationWithMode("Remote (US)", "remote"), "Remote (US)");
});

// --- segment helpers --------------------------------------------------------

test("placeHasSegment/stripPlaceSegment work across ';' entries and every separator", () => {
  assert.equal(placeHasSegment("Toronto; Remote", "Remote"), true);
  assert.equal(placeHasSegment("Remote Canada", "Remote"), false);
  assert.equal(stripPlaceSegment("Canada · Remote · Toronto", "Remote"), "Canada · Toronto");
  assert.equal(stripPlaceSegment("Toronto, Canada", "Remote"), "Toronto, Canada");
});

// --- class-wide: no label the display path builds repeats an adjacent token -

test("every dirty shape, through both display paths, yields no repeated adjacent token", () => {
  const dirty = [
    "RemoteRemote Location, All States",
    "Remote Remote",
    "Remote Location, Remote City",
    "Remote Location; Remote Location",
    "US FL Remote; US NY Remote",
    "Remote - Remote",
  ];
  for (const raw of dirty) {
    for (const work_type of ["remote", "hybrid", undefined] as const) {
      const place = placeWithWorkMode(locationText(job({ location: raw, work_type })), work_type);
      const card = locationSummary(locationText(job({ location: raw, work_type })));
      for (const label of [place, card]) {
        for (const seg of label.split(/\s*[;·,]\s*/)) {
          assert.doesNotMatch(seg, REPEATED_ADJACENT, `${raw} [${work_type}] -> ${label}`);
        }
      }
    }
  }
});
