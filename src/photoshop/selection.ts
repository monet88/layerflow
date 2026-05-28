import { app, core, imaging } from 'photoshop';
import { clampRectToDoc } from './document-utils';

export interface SelectionBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface SelectionMaskRgba {
  data: Uint8Array;
  width: number;
  height: number;
}

// Adds 18% horizontal / 25% vertical padding around a selection rect, clamped to document bounds.
// Pattern from OpenAI-PS — gives the model context around the masked region.
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
    docWidth,
    docHeight,
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
// Alpha encoding follows the OpenAI convention: 0 = edit this pixel, 255 = preserve.
// Falls back to a rectangular mask if imaging.getSelection is unavailable (PS 24.x) or selection
// type is unsupported. Must run inside executeAsModal — imaging API requires modal context.
// imaging.getSelection() leaks memory if imageData.dispose() is omitted; always dispose in finally.
export async function getSelectionMask(bounds: SelectionBounds): Promise<SelectionMaskRgba> {
  return await core.executeAsModal(
    async () => {
      const doc = app.activeDocument;
      const { width, height, left, top, right, bottom } = bounds;

      let selectionData = new Uint8Array(width * height * 4);
      let gotPreciseMask = false;

      try {
        const selImg = await imaging.getSelection({
          documentID: doc.id,
          sourceBounds: { left, top, right, bottom },
        });
        try {
          const raw = await selImg.imageData.getData();
          for (let i = 0; i < width * height; i++) {
            const density = raw[i];
            selectionData[i * 4] = 0;
            selectionData[i * 4 + 1] = 0;
            selectionData[i * 4 + 2] = 0;
            selectionData[i * 4 + 3] = 255 - density;
          }
          gotPreciseMask = true;
        } finally {
          selImg.imageData.dispose();
        }
      } catch {
        console.warn(
          'InpaintKit: imaging.getSelection unavailable; using rectangular mask fallback',
        );
        selectionData = new Uint8Array(width * height * 4);
        for (let i = 0; i < width * height; i++) {
          selectionData[i * 4 + 3] = 0;
        }
      }

      if (!gotPreciseMask) {
        console.warn(
          'InpaintKit: rectangular mask fallback active — non-rectangular selection areas may not blend correctly',
        );
      }

      return { data: selectionData, width, height };
    },
    { commandName: 'InpaintKit: Read Selection Mask' },
  );
}
