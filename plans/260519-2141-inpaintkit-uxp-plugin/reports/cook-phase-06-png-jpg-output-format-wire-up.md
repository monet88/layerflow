# Phase 6 — PNG/JPG Output Format Wire-up

**Date:** 2026-05-20
**Trigger:** User request after `/ck:cook` Phase 6 finalize.
**Context:** Phase 6 success criteria included "PNG/JPG output format selected based on source transparency", but `detectOutputFormat()` was written to `image-processing.ts` without any call site. Plan phases 7-10 do not address this. User chose **Option 1: wire into provider request**.

## Problem

- Plan Phase 6 Step 6.7 specified `detectOutputFormat(sourcePixels, width, height)` operating on raw RGBA pixel buffers in `document-utils.ts`.
- Implementation kept the helper in `image-processing.ts` (where RGBA utilities already live — `invertMaskConvention`, `resizeMaskToMatch`).
- Source bytes flowing through the inpaint pipeline are PNG-encoded (output of `doc.saveAs.png()` in `export-image.ts`), not raw RGBA. Decoding to RGBA just to detect alpha would waste CPU on every generation.

## Solution

Added `detectPngOutputFormat(pngBytes)` to `image-processing.ts`:

- Validates 8-byte PNG signature.
- Reads IHDR color type at byte 25.
  - Type 0 (grayscale) / type 2 (RGB) → no alpha channel → safe to send as `jpeg`.
  - Type 4 (gray + alpha) / type 6 (RGB + alpha) → alpha present → keep `png`.
  - Type 3 (indexed) → scan first 4KB for `tRNS` chunk header; present = transparency.
- Falls back to `'png'` on any malformed input.

Wired into `falai-provider.ts`:

- `runFluxFill`: `output_format = detectPngOutputFormat(source) === 'jpg' ? 'jpeg' : 'png'`. Made `output_format` optional in `FluxFillPayload`.
- `runGptImage2Edit`: same logic, replaces hardcoded `'png'`.

Skipped:

- Generate flows (`runNanoBanana`, `runGptImage2Generate`) — no source image to inspect, kept PNG.
- Replicate provider — official model inputs do not expose an `output_format` field; server decides.
- `place-result.ts` — placement source is always PNG temp file, conversion would not save bandwidth (already downloaded).

## Verification

- `npm run typecheck`: clean
- `npm run build`: clean (1.30s, 1056.95kB bundle)

## Files Modified

- `src/services/image-processing.ts` — added `detectPngOutputFormat`
- `src/providers/falai-provider.ts` — Flux Fill + GPT Image 2 Edit use dynamic format
