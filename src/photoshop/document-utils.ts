import { app } from 'photoshop';

export interface DocInfo {
  id: number;
  width: number;
  height: number;
  resolution: number;
  colorMode: string;
  hasSelection: boolean;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Returns info about the active document. Throws if no document is open.
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
export function clampRectToDoc(rect: Rect, docWidth: number, docHeight: number): Rect {
  return {
    left: Math.max(0, rect.left),
    top: Math.max(0, rect.top),
    right: Math.min(docWidth, rect.right),
    bottom: Math.min(docHeight, rect.bottom),
  };
}

// Returns true if the active document is in a non-RGB mode that downstream APIs will refuse.
export function needsColorConversion(): boolean {
  const doc = app.activeDocument;
  return !!doc && doc.mode !== 'RGBColorMode';
}
