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

export async function rgbaToPngBytes(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  if (width <= 0 || height <= 0) {
    throw new Error('rgbaToPngBytes: width and height must be positive.');
  }
  if (rgba.length !== width * height * 4) {
    throw new Error('rgbaToPngBytes: RGBA buffer does not match width × height.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('rgbaToPngBytes: 2D canvas context is unavailable.');
  }

  const clamped = new Uint8ClampedArray(rgba.length);
  clamped.set(rgba);
  context.putImageData(new ImageData(clamped, width, height), 0, 0);

  const dataUrl = canvas.toDataURL('image/png');
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) {
    throw new Error('rgbaToPngBytes: canvas returned an invalid data URL.');
  }
  return base64ToBytes(dataUrl.slice(commaIndex + 1));
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

// Resolution buckets supported across providers. Picking is decoupled from any specific
// provider so the UI can show the chosen bucket before dispatch.
export type ResolutionBucket = 1024 | 2048 | 4096;

const BUCKETS: ResolutionBucket[] = [1024, 2048, 4096];

// Picks the smallest resolution bucket that fully covers the selection's max dimension,
// constrained to the model's declared options. Falls back to the largest available bucket
// if the selection is bigger than every option, or to 1024 if no buckets match.
export function selectResolutionBucket(
  selectionWidth: number,
  selectionHeight: number,
  supportedResolutions: number[],
): ResolutionBucket {
  const maxDim = Math.max(selectionWidth, selectionHeight);
  const available = BUCKETS.filter((b) => supportedResolutions.includes(b)).sort((a, b) => a - b);
  if (available.length === 0) return 1024;
  for (const bucket of available) {
    if (bucket >= maxDim) return bucket;
  }
  return available[available.length - 1];
}

// Detects whether an RGBA buffer contains any non-opaque pixels.
// Used to choose between PNG (preserves alpha) and JPG (smaller) output formats.
export function detectOutputFormat(rgbaPixels: Uint8Array): 'png' | 'jpg' {
  if (rgbaPixels.length % 4 !== 0) return 'png';
  for (let i = 3; i < rgbaPixels.length; i += 4) {
    if (rgbaPixels[i] < 255) return 'png';
  }
  return 'jpg';
}

// Detects PNG output format directly from PNG file bytes by parsing the IHDR color type
// without decoding pixel data. Color types 4/6 = always have alpha. Type 3 (indexed) may have
// a tRNS chunk for transparency. Types 0/2 never have alpha → safe to send as JPG.
// Returns 'png' as the safe fallback whenever the input is not a recognizable PNG.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function detectPngOutputFormat(pngBytes: Uint8Array): 'png' | 'jpg' {
  if (pngBytes.length < 26) return 'png';
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (pngBytes[i] !== PNG_SIGNATURE[i]) return 'png';
  }
  const colorType = pngBytes[25];
  if (colorType === 4 || colorType === 6) return 'png';
  if (colorType === 3) {
    // Scan a bounded window for a tRNS chunk header — palette images embed transparency there.
    const limit = Math.min(pngBytes.length - 3, 4096);
    for (let i = 33; i < limit; i++) {
      if (
        pngBytes[i] === 0x74 &&
        pngBytes[i + 1] === 0x52 &&
        pngBytes[i + 2] === 0x4e &&
        pngBytes[i + 3] === 0x53
      ) {
        return 'png';
      }
    }
    return 'jpg';
  }
  return 'jpg';
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
