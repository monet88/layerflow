# UXP Photoshop API Verification

Verified against official Adobe UXP Photoshop documentation (2026-05-20).
Source: `adobedocs/uxp-photoshop` (GitHub), Context7 index (benchmark 77.8, high reputation).

---

## Verified API Patterns

### 1. batchPlay

**Official signature:**
```javascript
await action.batchPlay(descriptorArray, options);
```

- `descriptorArray`: Array of action descriptor objects
- `options`: Empty `{}` in modern UXP. The second arg historically accepted `historyStateInfo` but this is deprecated since PS 2022.
- Must run inside `core.executeAsModal`

**Legacy options NOT valid in UXP:**
- `synchronousExecution` — CEP-era option, not applicable
- `modalBehavior` — CEP-era option, not applicable

**Error handling:**
- Invalid command → promise rejected
- Action failure → promise resolves with error object: `{ _obj: "error", message, result }`
- `result: -128` means user cancelled

---

### 2. executeAsModal

**Official signature:**
```javascript
await core.executeAsModal(targetFunction, options);
```

**Options:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| commandName | string | Yes | Shown in progress bar |
| descriptor | object | No | Passed as 2nd arg to targetFunction |
| interactive | boolean | No | Allow UI interactions within modal |
| timeOut | number | No | Seconds to retry if another modal active (PS 25.10+) |

**Modal conflict:** If another modal is active, throws error with `error.number === 9`.

**targetFunction receives:** `executionContext` with:
- `executionContext.isCancelled` — check for user cancellation
- `executionContext.reportProgress({ value, commandName })` — built-in progress bar
- `executionContext.hostControl.suspendHistory(options)` — coalesce undo steps
- `executionContext.hostControl.resumeHistory(suspensionID, commit?)` — resume history

---

### 3. History State Suspension

**Official API:**
```javascript
const suspensionID = await executionContext.hostControl.suspendHistory({
  documentID: doc.id,
  name: "Operation Name"
});

// ... modifications ...

await executionContext.hostControl.resumeHistory(suspensionID);       // commit
await executionContext.hostControl.resumeHistory(suspensionID, false); // rollback
```

**Alternative (simpler wrapper):**
```javascript
app.activeDocument.suspendHistory(async (context) => {
  // all changes here = one undo step
}, "History State Name");
```

---

### 4. Imaging API

**Require:** `const imaging = require('photoshop').imaging;`
**Requirement:** All imaging calls must run inside `executeAsModal`.

#### getPixels
```javascript
const result = await imaging.getPixels({
  documentID: doc.id,          // optional (defaults to active)
  layerID: layer.id,           // optional (composite if omitted)
  sourceBounds: { left, top, right, bottom },  // optional
  targetSize: { width, height },               // optional (scaling)
  colorSpace: "RGB",           // optional
  componentSize: 8             // optional (8 or 16)
});
// result.imageData → PhotoshopImageData
// result.sourceBounds → actual bounds used
const pixels = await result.imageData.getData(); // Uint8Array
result.imageData.dispose(); // REQUIRED — prevents memory leak
```

#### getSelection
```javascript
const result = await imaging.getSelection({
  documentID: doc.id,
  sourceBounds: { left, top, right, bottom }  // optional
});
// Returns grayscale representation (Quick Mask equivalent)
const data = await result.imageData.getData(); // Uint8Array single-channel
result.imageData.dispose(); // REQUIRED
```

**getData():** No arguments needed. Returns interleaved data by default.
The `{ chunky: true }` option is NOT documented.

#### putSelection
```javascript
await imaging.putSelection({
  documentID: doc.id,        // optional
  imageData: imageDataObj,   // PhotoshopImageData (from createImageDataFromBuffer)
  targetBounds: { left, top }, // optional (only left + top, no right/bottom)
  replace: true,             // optional (default true)
  commandName: "..."         // optional
});
```

#### putPixels
```javascript
await imaging.putPixels({
  documentID: doc.id,        // optional
  layerID: layer.id,         // required (must be pixel layer)
  imageData: imageDataObj,   // required (PhotoshopImageData)
  targetBounds: { left, top }, // optional
  replace: true,             // optional
  commandName: "..."         // optional
});
```

#### createImageDataFromBuffer
```javascript
const imageData = await imaging.createImageDataFromBuffer(buffer, {
  width: w,
  height: h,
  colorSpace: "RGB",        // or "Grayscale"
  colorProfile: "...",      // optional
  componentSize: 8,         // 8 or 16
  hasAlpha: false           // boolean
});
// ... use imageData ...
imageData.dispose(); // REQUIRED
```

#### getLayerMask
```javascript
const maskObj = await imaging.getLayerMask({
  documentID: doc.id,
  layerID: layer.id,
  kind: "user",              // "user" or "vector"
  sourceBounds: { left, top, right, bottom },  // optional
  targetSize: { width, height }                // optional
});
// Returns single-channel grayscale
const maskData = await maskObj.imageData.getData();
maskObj.imageData.dispose(); // REQUIRED
```

---

### 5. Memory Management

**Critical:** Every `PhotoshopImageData` object MUST be `.dispose()`'d after use.
Failure to dispose causes memory leaks that accumulate across plugin operations.

Pattern:
```javascript
const result = await imaging.getPixels({ ... });
try {
  const data = await result.imageData.getData();
  // ... process data ...
} finally {
  result.imageData.dispose();
}
```

---

### 6. Community Patterns (Not in Official Docs)

These patterns are NOT in Adobe's official UXP documentation but are widely used
by the community (recorded via Action Recorder, proven in plugins with thousands of stars):

#### placeEvent (Place Embedded)
```javascript
await action.batchPlay([{
  _obj: 'placeEvent',
  null: { _path: sessionToken, _kind: 'local' },
  freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
  offset: { _obj: 'offset', horizontal: { _unit: 'pixelsUnit', _value: 0 }, vertical: { _unit: 'pixelsUnit', _value: 0 } },
  _isCommand: true,
  _options: { dialogOptions: 'dontDisplay' },
}], {});
```
Source: Action Recorder output from File > Place Embedded.

#### Layer Mask from Selection
```javascript
await action.batchPlay([{
  _obj: 'make',
  new: { _class: 'channel' },
  at: { _ref: 'channel', _enum: 'channel', _value: 'mask' },
  using: { _enum: 'userMaskEnabled', _value: 'revealSelection' },
}], {});
```
Source: Action Recorder output from Add Layer Mask button.

#### Color Mode Conversion
```javascript
await action.batchPlay([{
  _obj: 'convertMode',
  _target: [{ _ref: 'document', _enum: 'ordinal' }],
  to: { _class: 'RGBColorMode' },
  merge: false,
  flatten: false,
}], {});
```

---

### 7. Storage & File System (UXP)

```javascript
const { storage } = require('uxp');
const { localFileSystem: fs } = storage;

// Temp folder (always available, auto-cleaned)
const tempFolder = await fs.getTemporaryFolder();
const file = await tempFolder.createFile('name.png', { overwrite: true });

// Write binary
await file.write(uint8Array, { format: fs.formats.binary });

// Read binary
const data = await file.read({ format: fs.formats.binary });

// Session token (required for batchPlay file operations)
const token = await fs.createSessionToken(file);

// Cleanup
await file.delete();
```

---

### 8. Persistent Storage

| Type | API | Use for |
|------|-----|---------|
| Settings | `localStorage.setItem/getItem` | Non-sensitive prefs |
| Secrets | `require('uxp').storage.secureStorage` | API keys, tokens |

SecureStorage uses OS keychain (macOS Keychain / Windows Credential Manager).

---

## Verification Status

| Plan Section | Status | Notes |
|-------------|--------|-------|
| batchPlay options | FIXED | Removed legacy BP_OPTIONS |
| executeAsModal pattern | OK | Correct usage throughout |
| imaging.getSelection | FIXED | Removed undocumented `{ chunky: true }` |
| imaging.putSelection | FIXED | Uses createImageDataFromBuffer + correct targetBounds |
| suspendHistory params | FIXED | Uses `{ documentID, name }` format |
| imageData.dispose() | OK | Documented in plan with warning comments |
| placeEvent | OK | Community pattern, clearly noted |
| Layer mask creation | OK | Community pattern, clearly noted |
| Document DOM (width/height/mode) | OK | Standard DOM API |
| File system / temp files | OK | Matches UXP docs |
