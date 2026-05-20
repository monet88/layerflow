import { app, core } from 'photoshop';
import { storage } from 'uxp';
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
// Handles CMYK conversion on a temporary duplicate; the user's original document is never touched.
// Must run inside executeAsModal (handled internally).
export async function exportDocumentRegion(rect: ExportRect): Promise<Uint8Array> {
  return await core.executeAsModal(
    async () => {
      const { localFileSystem } = storage;
      const tempFolder = await localFileSystem.getTemporaryFolder();
      const tempFile = await tempFolder.createFile('inpaintkit-export.png', { overwrite: true });

      const originalDoc = app.activeDocument;
      const workDoc = await originalDoc.duplicate();

      try {
        // Explicitly activate the duplicate by ID — prevents a race where app.activeDocument
        // could still reference the original after duplicate().
        const dup = app.documents.filter((d: { id: number }) => d.id === workDoc.id)[0];
        if (dup?.activate) {
          await dup.activate();
        }

        if (needsColorConversion()) {
          await bpConvertToRGB();
        }

        await workDoc.crop(
          { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
          0,
          rect.width,
          rect.height,
        );

        await workDoc.flatten();
        await workDoc.saveAs.png(tempFile, null, true);
      } finally {
        await workDoc.closeWithoutSaving();
      }

      const data = await tempFile.read({ format: localFileSystem.formats.binary });
      const bytes = new Uint8Array(data);

      try {
        await tempFile.delete();
      } catch {
        /* ignore cleanup errors */
      }

      return bytes;
    },
    { commandName: 'InpaintKit: Export Region' },
  );
}
