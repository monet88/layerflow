// Image utility helpers: base64 encode/decode, mask convention inversion, data URI building.
// All functions are pure and side-effect-free.

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesToDataUri(bytes: Uint8Array, mimeType: string = 'image/png'): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

// Converts internal RGBA mask (alpha=0 = edit) to provider RGBA mask (white=edit).
// Output: RGB white where caller wants edits, RGB black where caller wants preserved; alpha=255 everywhere.
// Returns a NEW Uint8Array — input untouched (immutability).
export function invertMaskConvention(rgbaMask: Uint8Array): Uint8Array {
  if (rgbaMask.length % 4 !== 0) {
    throw new Error('invertMaskConvention: input length must be a multiple of 4 (RGBA)');
  }
  const out = new Uint8Array(rgbaMask.length);
  for (let i = 0; i < rgbaMask.length; i += 4) {
    // alpha 0 -> "edit" -> white in provider convention
    const editIntensity = 255 - rgbaMask[i + 3];
    out[i] = editIntensity;
    out[i + 1] = editIntensity;
    out[i + 2] = editIntensity;
    out[i + 3] = 255;
  }
  return out;
}

// Resizes an RGBA buffer to a target width/height using nearest-neighbour sampling.
// Used when the mask dimensions differ from the source image dimensions (Phase 5 will hit this
// when context padding makes the source larger than the original selection bounds).
export function resizeMaskToMatch(
  mask: { data: Uint8Array; width: number; height: number },
  targetWidth: number,
  targetHeight: number,
): Uint8Array {
  if (mask.width === targetWidth && mask.height === targetHeight) {
    return new Uint8Array(mask.data);
  }
  const out = new Uint8Array(targetWidth * targetHeight * 4);
  const xRatio = mask.width / targetWidth;
  const yRatio = mask.height / targetHeight;
  for (let y = 0; y < targetHeight; y++) {
    const srcY = Math.min(mask.height - 1, Math.floor(y * yRatio));
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.min(mask.width - 1, Math.floor(x * xRatio));
      const srcIdx = (srcY * mask.width + srcX) * 4;
      const dstIdx = (y * targetWidth + x) * 4;
      out[dstIdx] = mask.data[srcIdx];
      out[dstIdx + 1] = mask.data[srcIdx + 1];
      out[dstIdx + 2] = mask.data[srcIdx + 2];
      out[dstIdx + 3] = mask.data[srcIdx + 3];
    }
  }
  return out;
}
