import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToDataUri,
  detectOutputFormat,
  detectPngOutputFormat,
  invertMaskConvention,
  resizeMaskToMatch,
  selectResolutionBucket,
} from './image-processing';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngWithColorType(colorType: number, extraBytes: number[] = []): Uint8Array {
  const bytes = new Uint8Array(Math.max(64, 34 + extraBytes.length));
  bytes.set(PNG_SIGNATURE, 0);
  bytes[25] = colorType;
  bytes.set(extraBytes, 34);
  return bytes;
}

describe('image-processing helpers', () => {
  it('round-trips bytes through base64 and data URIs', () => {
    const source = new Uint8Array([0, 1, 2, 253, 254, 255]);

    const encoded = bytesToBase64(source);
    expect(base64ToBytes(encoded)).toEqual(source);
    expect(bytesToDataUri(source, 'image/jpeg')).toBe(`data:image/jpeg;base64,${encoded}`);
  });

  it('inverts internal alpha masks to provider white-edit convention without mutation', () => {
    const source = new Uint8Array([
      10, 20, 30, 0,
      40, 50, 60, 128,
      70, 80, 90, 255,
    ]);

    const result = invertMaskConvention(source);

    expect(result).toEqual(new Uint8Array([
      255, 255, 255, 255,
      127, 127, 127, 255,
      0, 0, 0, 255,
    ]));
    expect(source).toEqual(new Uint8Array([
      10, 20, 30, 0,
      40, 50, 60, 128,
      70, 80, 90, 255,
    ]));
  });

  it('detects output format from RGBA alpha and PNG metadata', () => {
    expect(detectOutputFormat(new Uint8Array([10, 20, 30, 255]))).toBe('jpg');
    expect(detectOutputFormat(new Uint8Array([10, 20, 30, 254]))).toBe('png');
    expect(detectPngOutputFormat(new Uint8Array([1, 2, 3]))).toBe('png');
    expect(detectPngOutputFormat(pngWithColorType(6))).toBe('png');
    expect(detectPngOutputFormat(pngWithColorType(2))).toBe('jpg');
    expect(detectPngOutputFormat(pngWithColorType(3))).toBe('jpg');
    expect(detectPngOutputFormat(pngWithColorType(3, [0x74, 0x52, 0x4e, 0x53]))).toBe(
      'png',
    );
  });

  it('selects supported resolution buckets and resizes masks immutably', () => {
    expect(selectResolutionBucket(900, 1200, [1024, 2048])).toBe(2048);
    expect(selectResolutionBucket(5000, 2500, [1024, 4096])).toBe(4096);
    expect(selectResolutionBucket(512, 512, [])).toBe(1024);

    const mask = {
      width: 1,
      height: 2,
      data: new Uint8Array([
        1, 2, 3, 4,
        5, 6, 7, 8,
      ]),
    };

    expect(resizeMaskToMatch(mask, 2, 2)).toEqual(new Uint8Array([
      1, 2, 3, 4,
      1, 2, 3, 4,
      5, 6, 7, 8,
      5, 6, 7, 8,
    ]));
    expect(resizeMaskToMatch(mask, 1, 2)).not.toBe(mask.data);
  });
});
