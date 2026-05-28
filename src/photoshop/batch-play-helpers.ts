import { action } from 'photoshop';

// Low-level batchPlay wrappers used by all other PS modules.
// All batchPlay calls must run inside executeAsModal — pass empty options per official UXP docs.
// synchronousExecution / modalBehavior are undocumented legacy CEP options, not valid in UXP.

// Set a rectangular selection on the active document.
export async function bpSetRectSelection(
  top: number,
  left: number,
  bottom: number,
  right: number,
): Promise<void> {
  await action.batchPlay(
    [
      {
        _obj: 'set',
        _target: [{ _ref: 'channel', _property: 'selection' }],
        to: {
          _obj: 'rectangle',
          top: { _unit: 'pixelsUnit', _value: top },
          left: { _unit: 'pixelsUnit', _value: left },
          bottom: { _unit: 'pixelsUnit', _value: bottom },
          right: { _unit: 'pixelsUnit', _value: right },
        },
      },
    ],
    {},
  );
}

// Select a layer by ID without making it visible.
export async function bpSelectLayer(layerId: number): Promise<void> {
  await action.batchPlay(
    [
      {
        _obj: 'select',
        _target: [{ _ref: 'layer', _id: layerId }],
        makeVisible: false,
      },
    ],
    {},
  );
}

// Add a reveal-selection layer mask to the currently selected layer.
export async function bpAddLayerMaskFromSelection(): Promise<void> {
  await action.batchPlay(
    [
      {
        _obj: 'make',
        new: { _class: 'channel' },
        at: { _ref: 'channel', _enum: 'channel', _value: 'mask' },
        using: { _enum: 'userMaskEnabled', _value: 'revealSelection' },
      },
    ],
    {},
  );
}

// Place a file as a Smart Object. path must be a session token (not a raw path).
export async function bpPlaceAsSmartObject(sessionToken: string): Promise<void> {
  await action.batchPlay(
    [
      {
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
      },
    ],
    {},
  );
}

// Convert active document to RGB. CMYK guard — only call on a duplicate, never the original.
export async function bpConvertToRGB(): Promise<void> {
  await action.batchPlay(
    [
      {
        _obj: 'convertMode',
        _target: [{ _ref: 'document', _enum: 'ordinal' }],
        to: { _class: 'RGBColorMode' },
        merge: false,
        flatten: false,
      },
    ],
    {},
  );
}
