# Timing Talk — Announcer (new site)

A standalone, self-contained announcer screen (`public/announcer.html`) that mirrors the
Omarchy "Dark Mawson" announcer widget: PREVIOUS RUN / CURRENT / HOLD SCREEN / LIVE TIMING
controls, per-lane driver cards with photo cycling (NEXT / NOT THEM), ANNOUNCER COPY +
engine COMBO from the tech card, OLD RUNS per lane, a prominent LIVE SPLITS board
(DIAL, R/T, 60, 330, 660, 660 MPH, 1000, E.T., MPH, MOV) and an on-screen weather band
(DA / temp / humidity / wind / baro). Responsive down to phone widths.

## The data rule

- **LIVE Timing Talk** (Firebase RTDB `/devices/{deviceId}/raceState/current` + `/status`)
  drives **only** the next pair on the line and their times down the track. Nothing else.
- **getresults history** (TimingApp `/api/runs`, CORS-enabled) drives **history only**:
  OLD RUNS per lane, BEST ET / BEST RT / TOP MPH, and PREVIOUS RUN browsing.
  It never decides who is on the line.
- Tech cards / ANNOUNCER COPY / COMBO come from the Timing Talk API
  (`https://nhra-timing-api.web.app/api/tech-cards/{member}`); COPY lines are shown only
  when present on the card — never invented.
- Driver photos: the tech card `photo_url` first, then keyless CC image search
  (Openverse) as extra candidates. NOT THEM rejections persist in `localStorage`.
- Weather: Open-Meteo (keyless) for a location set in ⚙ settings; density altitude is
  computed with the NWS virtual-temperature formula. Blank until a location is set.

## Device selection

Same convention as the rest of Timing Talk: `localStorage["tt-selected-device"]`, plus a
`?device=<id>` query override and a picker in ⚙ settings. When nothing is selected the
page auto-picks the freshest online device from `/api/tracks`.

## Deploy (new Firebase Hosting site)

One-time site creation, then deploy from this folder:

```bash
cd announcer
npx firebase-tools hosting:sites:create tt-announcer --project nhra-timing-api   # once
npx firebase-tools deploy --only hosting:announcer --project nhra-timing-api
```

The page is fully self-contained (all API URLs are absolute), so
`public/announcer.html` can also be copied over the old site's `announcer.html` on
`nhra-timing-api.web.app` without touching any other page.

## Verify with a live device

1. Open the site, pick the live timing Pi in ⚙ settings (green dot = online).
2. The header shows the event (from getresults) + category/round (live); lane panels fill
   with the pair on the line; splits flash in as the cars go down track.
3. HOLD SCREEN freezes the pair; live keeps tracking underneath; press again or CURRENT
   to catch up. PREVIOUS RUN pages back through getresults pairs; CURRENT returns live.
4. ⚙ settings has local 2-wide/4-wide test runs (simulation only — nothing is written).
