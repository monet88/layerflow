import { app, core, action, imaging } from 'photoshop';
import { storage } from 'uxp';
import {
  bpAddLayerMaskFromSelection,
  bpPlaceAsSmartObject,
  bpSelectLayer,
} from './batch-play-helpers';

export interface PlaceTargetRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PlaceMaskData {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface PlaceOptions {
  pngBytes: Uint8Array;
  // Target rectangle in document pixels — result is scaled to fit this rect.
  targetRect: PlaceTargetRect;
  // Optional RGBA mask (alpha=0 where the result should be visible, alpha=255 where preserved).
  maskData?: PlaceMaskData;
  layerName?: string;
}

// Places AI-generated PNG as a Smart Object with optional pixel-accurate layer mask.
// All operations merged into a single undo step via suspendHistory/resumeHistory.
export async function placeResultAsSmartObject(opts: PlaceOptions): Promise<void> {
  const { pngBytes, targetRect, maskData, layerName = 'InpaintKit Result' } = opts;

  return await core.executeAsModal(
    async (executionContext: {
      hostControl: {
        suspendHistory: (a: { documentID: number; name: string }) => Promise<unknown>;
        resumeHistory: (state: unknown, accept?: boolean) => Promise<void>;
      };
    }) => {
      const { localFileSystem: fs } = storage;

      const tempFolder = await fs.getTemporaryFolder();
      const tempFile = await tempFolder.createFile('inpaintkit-result.png', { overwrite: true });
      await tempFile.write(pngBytes, { format: fs.formats.binary });

      const doc = app.activeDocument;
      const historyState = await executionContext.hostControl.suspendHistory({
        documentID: doc.id,
        name: `InpaintKit: ${layerName}`,
      });

      try {
        const token = await fs.createSessionToken(tempFile);

        await bpPlaceAsSmartObject(token);

        const placedLayer = doc.activeLayers[0];
        if (!placedLayer) throw new Error('Placed layer not found after placeEvent');

        placedLayer.name = layerName;

        await action.batchPlay(
          [
            {
              _obj: 'transform',
              _target: [{ _ref: 'layer', _id: placedLayer.id }],
              freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
              offset: {
                _obj: 'offset',
                horizontal: {
                  _unit: 'pixelsUnit',
                  _value: targetRect.left + targetRect.width / 2,
                },
                vertical: {
                  _unit: 'pixelsUnit',
                  _value: targetRect.top + targetRect.height / 2,
                },
              },
              width: { _unit: 'percentUnit', _value: 100 },
              height: { _unit: 'percentUnit', _value: 100 },
              interfaceIconFrameDimmed: {
                _enum: 'interpolationType',
                _value: 'bicubic',
              },
            },
          ],
          {},
        );

        if (maskData) {
          await bpSelectLayer(placedLayer.id);
          // Convert RGBA mask (alpha=0 means "edit") to single-channel density for putSelection.
          // density=255 = fully selected = visible through the mask.
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
          try {
            await imaging.putSelection({
              documentID: doc.id,
              imageData: selectionImageData,
              targetBounds: { left: targetRect.left, top: targetRect.top },
              replace: true,
            });
          } finally {
            selectionImageData.dispose();
          }
          await bpAddLayerMaskFromSelection();
        }

        await executionContext.hostControl.resumeHistory(historyState);
      } catch (e) {
        await executionContext.hostControl.resumeHistory(historyState, false);
        throw e;
      } finally {
        try {
          await tempFile.delete();
        } catch {
          /* ignore cleanup errors */
        }
      }
    },
    { commandName: `InpaintKit: Place ${layerName}` },
  );
}
