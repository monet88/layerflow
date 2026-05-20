---
title: "Phase 3: Photoshop Integration"
sprint: 1
status: pending
priority: P1
effort: 8h
depends_on: [phase-01]
---

# Phase 3: Photoshop Integration

**Priority:** P1 — Required for Phase 5 pipeline
**Estimated effort:** 8h
**Status:** pending
**Blocked by:** Phase 1

---

## Context Links

- [plan.md](./plan.md) — Overview
- [researcher-uxp-report.md](../reports/researcher-uxp-report.md) — PS API reference (sections 3–4, 7)
- [researcher-architecture-report.md](../reports/researcher-architecture-report.md) — Pixel export patterns (section 2.3–2.6)

---

## Overview

Implement all Photoshop-side operations: reading document info, reading selections, exporting canvas regions as PNG, creating Smart Object layers with masks, and placing AI-generated results. All functions run inside `executeAsModal`. No AI calls in this phase — operations are tested with static PNG data.

---

## Key Insights

**Pixel export (critical decision):** Use `doc.saveAs.png()` on a temp duplicate, NOT `imaging.getPixels()`. Rationale from OpenAI-PS and Auto-PS-SD:
- `saveAs.png()` handles layer compositing, ICC profile, bit depth automatically
- `imaging.getPixels()` is correct only for reading raw layer data or the selection mask — not for full composite export
- Save to `plugin-temp:/` sandbox (no user permission needed)

**Selection mask (critical decision):** Use `imaging.getSelection()` for accurate pixel-level mask data. Fallback to rectangular bounds mask when PS < 25 or when selection is simple rectangle.

**Smart Object placement:** Must use `batchPlay` with `placeEvent`. The UXP DOM API does not expose Smart Object creation directly (only regular pixel layers).

**executeAsModal scope:** All batchPlay calls and imaging calls must be inside `executeAsModal`. Group multiple operations into a single modal call where possible (reduces history pollution).

**History grouping:** Use `executionContext.hostControl.suspendHistory()` to merge all operations (create layer, place, transform, mask) into a single undo step named "InpaintKit: [description]".

**CMYK guard:** Must detect and convert CMYK to RGB before export. Neither Auto-PS-SD nor OpenAI-PS handles this — it's a gap. Silently convert a DUPLICATE document (never touch the user's original).

---

## Requirements

**Functional:**
- `getDocumentInfo()`: returns doc dimensions, resolution, color mode, whether selection is active
- `getSelectionBounds()`: returns `{ left, top, right, bottom }` or `null`
- `getSelectionMask()`: returns RGBA Uint8Array where alpha encodes selection density (0=edit, 255=preserve)
- `exportDocumentRegion(rect)`: exports a cropped region of the composite as PNG bytes
- `placeResultAsSmartObject(pngBytes, rect, maskRgba?)`: creates Smart Object layer, transforms to `rect`, applies mask
- CMYK documents: detected and a temp RGB copy is used for export; original untouched
- Context padding: `expandRectForInpaintContext(rect, docWidth, docHeight)` adds 18% H / 25% V padding

**Non-functional:**
- All imaging data disposals in `try/finally`
- Exported PNG files in plugin temp folder, cleaned up after use
- Single undo step for place+transform+mask operations
- Works on PS 24.x with rectangular mask fallback (log warning when `imaging.getSelection` unavailable)

---

## Architecture

```
src/photoshop/
├── document-utils.ts        # getDocumentInfo, getColorMode, CMYK conversion
├── selection.ts             # getSelectionBounds, getSelectionMask, expandRect
├── export-image.ts          # exportDocumentRegion → PNG bytes
├── place-result.ts          # placeResultAsSmartObject: placeEvent + transform + mask
└── batch-play-helpers.ts    # Low-level batchPlay wrappers (reusable primitives)
```

Data flow:
```
PS Document
    ↓ document-utils.ts → DocInfo (dimensions, colorMode)
    ↓ selection.ts → SelectionInfo (bounds, maskRgba)
    ↓ export-image.ts → PNG bytes (Uint8Array)
         [sent to AI provider in Phase 5]
    ↑ place-result.ts ← AI result PNG bytes
         → Smart Object layer + mask in document
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/photoshop/document-utils.ts` | Doc info, CMYK guard |
| `src/photoshop/selection.ts` | Selection reading + mask extraction |
| `src/photoshop/export-image.ts` | Region export as PNG |
| `src/photoshop/place-result.ts` | Smart Object placement + layer mask |
| `src/photoshop/batch-play-helpers.ts` | Reusable batchPlay primitives |

---

## Implementation Steps

### Step 3.1 — Create `src/photoshop/batch-play-helpers.ts`

Low-level batchPlay wrappers used by all other PS modules:

```typescript
const { action } = require('photoshop');

// All batchPlay calls run inside executeAsModal — pass empty options per official UXP docs.
// synchronousExecution/modalBehavior are undocumented legacy CEP options, not valid in UXP.

// Set a rectangular selection on the active document.
export async function bpSetRectSelection(
  top: number, left: number, bottom: number, right: number,
): Promise<void> {
  await action.batchPlay([{
    _obj: 'set',
    _target: [{ _ref: 'channel', _property: 'selection' }],
    to: {
      _obj: 'rectangle',
      top: { _unit: 'pixelsUnit', _value: top },
      left: { _unit: 'pixelsUnit', _value: left },
      bottom: { _unit: 'pixelsUnit', _value: bottom },
      right: { _unit: 'pixelsUnit', _value: right },
    },
  }], {});
}

// Select a layer by ID.
export async function bpSelectLayer(layerId: number): Promise<void> {
  await action.batchPlay([{
    _obj: 'select',
    _target: [{ _ref: 'layer', _id: layerId }],
    makeVisible: false,
  }], {});
}

// Add a reveal-selection layer mask to the currently selected layer.
export async function bpAddLayerMaskFromSelection(): Promise<void> {
  await action.batchPlay([{
    _obj: 'make',
    new: { _class: 'channel' },
    at: { _ref: 'channel', _enum: 'channel', _value: 'mask' },
    using: { _enum: 'userMaskEnabled', _value: 'revealSelection' },
  }], {});
}

// Place a file as a Smart Object. path must be a session token (not a raw path).
export async function bpPlaceAsSmartObject(sessionToken: string): Promise<void> {
  await action.batchPlay([{
    _obj: 'placeEvent',
    null: { _path: sessionToken, _kind: 'local' },
    freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
    offset: {
      _obj: 'offset',
      horizontal: { _unit: 'pixelsUnit', _value: 0 },
      vertical: { _unit: 'pixelsUnit', _value: 0 },
    },
    _isCommand: true,
    _options: { dialogOptions: 'dontDisplay' },
  }], {});
}

// Convert active document to RGB (CMYK guard — call on a duplicate, not original).
export async function bpConvertToRGB(): Promise<void> {
  await action.batchPlay([{
    _obj: 'convertMode',
    _target: [{ _ref: 'document', _enum: 'ordinal' }],
    to: { _class: 'RGBColorMode' },
    merge: false,
    flatten: false,
  }], {});
}
```

### Step 3.2 — Create `src/photoshop/document-utils.ts`

```typescript
const { app } = require('photoshop');
import { bpConvertToRGB } from './batch-play-helpers';

export interface DocInfo {
  id: number;
  width: number;
  height: number;
  resolution: number;
  colorMode: string;  // "RGBColorMode", "CMYKColorMode", etc.
  hasSelection: boolean;
}

// Returns info about the active document.
// Throws if no document is open.
export function getDocumentInfo(): DocInfo {
  const doc = app.activeDocument;
  if (!doc) throw new Error('No document open. Open a file in Photoshop first.');

  return {
    id: doc.id,
    width: Math.round(doc.width),
    height: Math.round(doc.height),
    resolution: doc.resolution,
    colorMode: doc.mode,
    hasSelection: doc.selection?.bounds != null,
  };
}

// Clamps a rectangle to document bounds.
export function clampRectToDoc(
  rect: { left: number; top: number; right: number; bottom: number },
  docWidth: number, docHeight: number,
) {
  return {
    left: Math.max(0, rect.left),
    top: Math.max(0, rect.top),
    right: Math.min(docWidth, rect.right),
    bottom: Math.min(docHeight, rect.bottom),
  };
}

// Returns true if the active document is in a non-RGB mode that APIs won't accept.
export function needsColorConversion(): boolean {
  const doc = app.activeDocument;
  return doc && doc.mode !== 'RGBColorMode';
}
```

**CMYK guard strategy:** `exportDocumentRegion` in `export-image.ts` will duplicate the document, call `bpConvertToRGB()` on the duplicate, export, then close the duplicate. The original document is never modified.

### Step 3.3 — Create `src/photoshop/selection.ts`

```typescript
const { app, core, imaging } = require('photoshop');
import { clampRectToDoc } from './document-utils';

export interface SelectionBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

// Adds 18% horizontal / 25% vertical padding around a selection rect,
// clamped to document bounds. Pattern from OpenAI-PS.
export function expandRectForInpaintContext(
  rect: SelectionBounds,
  docWidth: number,
  docHeight: number,
): SelectionBounds {
  const padH = Math.round(rect.width * 0.18);
  const padV = Math.round(rect.height * 0.25);
  const expanded = clampRectToDoc(
    {
      left: rect.left - padH,
      top: rect.top - padV,
      right: rect.right + padH,
      bottom: rect.bottom + padV,
    },
    docWidth, docHeight,
  );
  return {
    ...expanded,
    width: expanded.right - expanded.left,
    height: expanded.bottom - expanded.top,
  };
}

// Returns the active selection bounds or null if no selection.
export function getSelectionBounds(): SelectionBounds | null {
  const doc = app.activeDocument;
  const bounds = doc?.selection?.bounds;
  if (!bounds) return null;
  const left = Math.round(bounds.left);
  const top = Math.round(bounds.top);
  const right = Math.round(bounds.right);
  const bottom = Math.round(bounds.bottom);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

// Returns per-pixel selection density as RGBA Uint8Array.
// Alpha channel: 0 = edit this pixel, 255 = preserve this pixel (OpenAI convention).
// Falls back to a rectangular mask if imaging.getSelection is unavailable (PS 24.x).
// IMPORTANT: Must be called inside executeAsModal — imaging API requires modal context.
// IMPORTANT: imaging.getSelection() leaks memory if imageData.dispose() is not called.
//   Always wrap getData() + processing in try/finally with dispose() in the finally block.
//   This matches Adobe's documented pattern for the Imaging API (see UXP research report §5.5).
export async function getSelectionMask(
  bounds: SelectionBounds,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  return await core.executeAsModal(async () => {
    const doc = app.activeDocument;
    const { width, height, left, top, right, bottom } = bounds;

    let selectionData: Uint8Array;
    let gotPreciseMask = false;

    try {
      const selImg = await imaging.getSelection({
        documentID: doc.id,
        sourceBounds: { left, top, right, bottom },
      });
      try {
        // getData returns a flat Uint8Array of single-channel values (0–255 density).
        const raw = await selImg.imageData.getData();
        // Convert single-channel density to RGBA: invert alpha for OpenAI convention.
        selectionData = new Uint8Array(width * height * 4);
        for (let i = 0; i < width * height; i++) {
          // density 255 = fully selected = should be edited → alpha 0 (transparent = edit)
          const density = raw[i];
          selectionData[i * 4] = 0;       // R
          selectionData[i * 4 + 1] = 0;   // G
          selectionData[i * 4 + 2] = 0;   // B
          selectionData[i * 4 + 3] = 255 - density;  // A: 0=edit, 255=preserve
        }
        gotPreciseMask = true;
      } finally {
        selImg.imageData.dispose();  // Always dispose — imaging memory leak risk
    }
  } catch {
    // PS 24.x or selection type not supported by getSelection — fall back to rect.
    console.warn('InpaintKit: imaging.getSelection unavailable; using rectangular mask fallback');
    selectionData = new Uint8Array(width * height * 4);
    // Rectangular mask: transparent (alpha=0) over the entire bounds = inpaint everything inside
    // Outside this region, caller handles via crop
    for (let i = 0; i < width * height; i++) {
      selectionData[i * 4 + 3] = 0;  // all alpha=0 = edit entire region
    }
  }

  if (!gotPreciseMask) {
    console.warn('InpaintKit: rectangular mask fallback active — non-rectangular selection areas may not blend correctly');
  }

  return { data: selectionData, width, height };
  }, { commandName: 'InpaintKit: Read Selection Mask' });
}
```

### Step 3.4 — Create `src/photoshop/export-image.ts`

```typescript
const { app, core } = require('photoshop');
const { storage } = require('uxp');
import { bpConvertToRGB } from './batch-play-helpers';
import { needsColorConversion } from './document-utils';

export interface ExportRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

// Exports a region of the active document composite as PNG bytes.
// Handles CMYK conversion on a temporary duplicate — original untouched.
// rect: the crop region in document pixels.
export async function exportDocumentRegion(rect: ExportRect): Promise<Uint8Array> {
  return await core.executeAsModal(async () => {
    const { localFileSystem } = storage;
    const tempFolder = await localFileSystem.getTemporaryFolder();
    const tempFile = await tempFolder.createFile('inpaintkit-export.png', { overwrite: true });

    const originalDoc = app.activeDocument;
    let workDoc = originalDoc;

    // Duplicate to avoid modifying original
    workDoc = await originalDoc.duplicate();

    try {
      // Explicitly activate the duplicate by ID — prevents race where
      // app.activeDocument might still reference the original after duplicate()
      await app.documents.filter(d => d.id === workDoc.id)[0]?.activate?.();
      // Fallback: batchPlay select if activate() not available
      // await action.batchPlay([{ _obj: 'select', _target: [{ _ref: 'document', _id: workDoc.id }] }], {});

      // CMYK guard: convert duplicate to RGB if needed
      if (needsColorConversion()) {
        await bpConvertToRGB();
      }

      // Crop to region
      await workDoc.crop(
        {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
        0,       // angle
        rect.width,
        rect.height,
      );

      // Flatten and export as PNG
      await workDoc.flatten();
      await workDoc.saveAs.png(tempFile, null, true);

    } finally {
      // Always close the duplicate
      await workDoc.closeWithoutSaving();
    }

    // Read the PNG bytes
    const data = await tempFile.read({ format: localFileSystem.formats.binary });
    const bytes = new Uint8Array(data);

    // Clean up temp file
    try { await tempFile.delete(); } catch { /* ignore cleanup errors */ }

    return bytes;
  }, { commandName: 'InpaintKit: Export Region' });
}
```

### Step 3.5 — Create `src/photoshop/place-result.ts`

```typescript
const { app, core, action, imaging } = require('photoshop');
const { storage } = require('uxp');
import { bpPlaceAsSmartObject, bpSelectLayer, bpSetRectSelection, bpAddLayerMaskFromSelection } from './batch-play-helpers';

export interface PlaceOptions {
  pngBytes: Uint8Array;
  // The target rectangle in document pixels — result is scaled to fit this rect.
  targetRect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  // Optional: RGBA mask for selection-shaped mask (alpha=0 where visible)
  maskData?: { data: Uint8Array; width: number; height: number };
  layerName?: string;
}

// Places AI-generated PNG as a Smart Object with optional selection-based layer mask.
// All operations merged into a single undo step.
export async function placeResultAsSmartObject(opts: PlaceOptions): Promise<void> {
  const { pngBytes, targetRect, maskData, layerName = 'InpaintKit Result' } = opts;

  return await core.executeAsModal(async (executionContext: any) => {
    const { localFileSystem: fs } = storage;

    // Write PNG to temp file
    const tempFolder = await fs.getTemporaryFolder();
    const tempFile = await tempFolder.createFile('inpaintkit-result.png', { overwrite: true });
    await tempFile.write(pngBytes, { format: fs.formats.binary });

    // Suspend history so place + transform + mask = one undo step
    const doc = app.activeDocument;
    const historyState = await executionContext.hostControl.suspendHistory({
      documentID: doc.id,
      name: `InpaintKit: ${layerName}`,
    });

    try {
      // Get a session token for batchPlay (required — raw paths not accepted)
      const token = await fs.createSessionToken(tempFile);

      // Place as Smart Object
      await bpPlaceAsSmartObject(token);

      // The newly placed layer is now active; get its ID
      const placedLayer = doc.activeLayers[0];
      if (!placedLayer) throw new Error('Placed layer not found after placeEvent');

      // Rename the layer
      placedLayer.name = layerName;

      // Transform (scale + position) to target rect
      await action.batchPlay([{
        _obj: 'transform',
        _target: [{ _ref: 'layer', _id: placedLayer.id }],
        freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
        offset: {
          _obj: 'offset',
          horizontal: { _unit: 'pixelsUnit', _value: targetRect.left + targetRect.width / 2 },
          vertical: { _unit: 'pixelsUnit', _value: targetRect.top + targetRect.height / 2 },
        },
        width: { _unit: 'percentUnit', _value: 100 },
        height: { _unit: 'percentUnit', _value: 100 },
        interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubic' },
      }], {});

      // Apply pixel-accurate layer mask from selection data
      if (maskData) {
        await bpSelectLayer(placedLayer.id);
        // Convert RGBA mask (alpha=0 means "edit") to single-channel density for putSelection
        // density=255 means "selected" (will be visible through mask)
        const density = new Uint8Array(maskData.width * maskData.height);
        for (let i = 0; i < density.length; i++) {
          density[i] = 255 - maskData.data[i * 4 + 3];
        }
        const selectionImageData = await imaging.createImageDataFromBuffer(density, {
          width: maskData.width,
          height: maskData.height,
          colorSpace: 'Grayscale',
          componentSize: 8,
          hasAlpha: false,
        });
        await imaging.putSelection({
          documentID: doc.id,
          imageData: selectionImageData,
          targetBounds: { left: targetRect.left, top: targetRect.top },
          replace: true,
        });
        selectionImageData.dispose();
        await bpAddLayerMaskFromSelection();
      }

      await executionContext.hostControl.resumeHistory(historyState);
    } catch (e) {
      // Discard history on failure (don't leave partial state in undo stack)
      await executionContext.hostControl.resumeHistory(historyState, false);
      throw e;
    } finally {
      try { await tempFile.delete(); } catch { /* ignore */ }
    }
  }, { commandName: `InpaintKit: Place ${layerName}` });
}
```

---

## Success Criteria

- [ ] `getDocumentInfo()` returns correct width/height for an open document
- [ ] `getSelectionBounds()` returns `null` when no selection is active
- [ ] `getSelectionBounds()` returns correct bounds after making a rectangular marquee selection
- [ ] `getSelectionMask()` returns RGBA Uint8Array with correct dimensions matching bounds
- [ ] `exportDocumentRegion()` produces a valid PNG file (viewable in any image viewer)
- [ ] `exportDocumentRegion()` on a CMYK doc exports a valid RGB PNG without modifying original
- [ ] `placeResultAsSmartObject()` places a test PNG as a new Smart Object layer at correct position
- [ ] Placed layer appears in Layers panel named "InpaintKit Result"
- [ ] Layer mask is applied (layer thumbnail shows mask icon in Layers panel)
- [ ] All operations produce a single undo entry named "InpaintKit: ..."
- [ ] `npm run typecheck` passes

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `imaging.getSelection()` API not available on PS 24 | High | Medium | Rectangular fallback implemented; log clear warning |
| `imaging.getSelection` memory leak if dispose() omitted | High (known bug) | Medium | try/finally disposal in every code path |
| `placeEvent` requires session token not raw path | High (common mistake) | High | Already using `fs.createSessionToken(file)` |
| `doc.crop()` API signature differs across PS versions | Medium | Medium | Test on PS 24 and PS 25+; use batchPlay crop as fallback |
| CMYK duplicate closure missed on error | Medium | Low | try/finally ensures `workDoc.closeWithoutSaving()` always runs |
| Transform values produce off-position placement | Medium | High | Verify center-point math; log actual bounds post-transform |
| `saveAs.png()` not available on document duplicate | Low | High | Verify API on duplicated doc; fallback to batchPlay save |

---

## Rollback Plan

All PS operations are additive (new layers only) or isolated to temp duplicates. No destructive operations on user's document. Rollback = close any unintended layers manually (or Ctrl+Z for undo). Source files can be reverted to previous state independently.

---

## File Ownership

This phase owns exclusively:
- `src/photoshop/*.ts`

Phase 4 (providers) and Phase 5 (pipeline) read but do not modify these files.
