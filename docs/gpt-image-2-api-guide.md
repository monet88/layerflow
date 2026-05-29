# GPT-Image-2 API — Hướng Dẫn Sử Dụng

> **Endpoint:** `http://127.0.0.1:8333`
> **Model:** `gpt-image-2`
> **Tested:** 2026-05-29

---

## Xác Thực

```
Authorization: Bearer <APP_API_KEY>
```

> Warning: **Không set `Content-Type` thủ công** khi dùng multipart upload — để fetch/axios tự set với boundary.

---

## 1. Text to Image

**Endpoint:** `POST /v1/images/generations`
**Content-Type:** `application/json`

```json
{
  "model": "gpt-image-2",
  "prompt": "A futuristic cyberpunk city at night with neon lights",
  "n": 1,
  "size": "1024x1024",
  "quality": "standard"
}
```

**Lưu ý về `n`:** Tham số `n` được chấp nhận nhưng **luôn chỉ trả về 1 ảnh** dù đặt bất kỳ giá trị nào. Không có lỗi — silently ignore.

**Sizes hỗ trợ:**

| Size | Chiều |
|------|-------|
| `1024x1024` | Vuông |
| `1536x1024` | Landscape (ngang) |
| `1024x1536` | Portrait (dọc) |
| `512x512` | ❌ (below minimum) |
| `256x256` | ❌ (below minimum) |

**Quality params:** `standard`, `hd`, `high`, `medium`, `low` — đều được chấp nhận.

**Response:**

```json
{
  "created": 1780017206,
  "data": [
    { "b64_json": "/9j/4AAQ..." }
  ]
}
```

**Ví dụ Node.js:**

```js
const fs = require('fs');

const res = await fetch('http://127.0.0.1:8333/v1/images/generations', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer monet-4292',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'gpt-image-2',
    prompt: 'A mountain landscape at golden hour',
    n: 1,
    size: '1536x1024',
    quality: 'hd'
  })
});

const data = await res.json();
const buf = Buffer.from(data.data[0].b64_json, 'base64');
fs.writeFileSync('output.jpg', buf);
```

---

## 2. Image Editing

**Endpoint:** `POST /v1/images/edits`
**Content-Type:** `multipart/form-data` ← **bắt buộc**

> Warning: `gpt-image-2` **chỉ nhận file upload** qua multipart form data.
> Gửi base64 hoặc URL trong JSON body sẽ bị lỗi `stream disconnected`.

### Fields

| Field | Type | Mô tả |
|-------|------|-------|
| `model` | string | `gpt-image-2` |
| `prompt` | string | Mô tả chỉnh sửa muốn thực hiện |
| `n` | string | Số ảnh output (nhưng luôn trả 1) |
| `image` | file | Reference image (append nhiều lần để gửi nhiều ảnh) |

### Giới hạn reference images

- Tối đa **~20 ảnh** — trên 20 bị timeout
- Không có lỗi giới hạn cứng, server xử lý tuỳ khả năng

**Ví dụ Node.js — 1 reference image:**

```js
const fs = require('fs');

const imageBuffer = fs.readFileSync('/path/to/reference.jpg');

const form = new FormData();
form.append('model', 'gpt-image-2');
form.append('prompt', 'Add dramatic storm clouds to the sky');
form.append('n', '1');
form.append('image', new Blob([imageBuffer], { type: 'image/jpeg' }), 'image.jpg');

const res = await fetch('http://127.0.0.1:8333/v1/images/edits', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer monet-4292' },
  // KHÔNG set Content-Type — fetch tự set với boundary
  body: form
});

const data = await res.json();
const buf = Buffer.from(data.data[0].b64_json, 'base64');
fs.writeFileSync('edited.jpg', buf);
```

**Ví dụ Node.js — nhiều reference images:**

```js
const fs = require('fs');

const refPaths = ['/path/ref1.jpg', '/path/ref2.jpg', '/path/ref3.jpg'];

const form = new FormData();
form.append('model', 'gpt-image-2');
form.append('prompt', 'Combine these images into one cohesive scene');
form.append('n', '1');

// Append nhiều lần cùng field name "image"
for (const [i, refPath] of refPaths.entries()) {
  const buf = fs.readFileSync(refPath);
  form.append('image', new Blob([buf], { type: 'image/jpeg' }), `image${i + 1}.jpg`);
}

const res = await fetch('http://127.0.0.1:8333/v1/images/edits', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer monet-4292' },
  body: form
});

const data = await res.json();
const buf = Buffer.from(data.data[0].b64_json, 'base64');
fs.writeFileSync('output.jpg', buf);
```

---

## 3. Tóm Tắt Giới Hạn

| Tham số | Giá trị |
|---------|---------|
| `n` output | Luôn **1** (n bị ignore) |
| `image` reference (edit) | 1 – **~20** (>20 timeout) |
| Sizes (text→image) | `1024x1024`, `1536x1024`, `1024x1536` |
| Input format (edit) | **multipart/form-data file upload** |
| Response format | `b64_json` (JPEG, ~700KB–3.2MB tuỳ size) |
| Response time | ~60–90 giây |

---

## 4. Xử Lý Lỗi

| HTTP | Thông điệp | Nguyên nhân | Cách xử lý |
|------|------------|-------------|------------|
| 400 | `"below the current minimum pixel budget"` | Size quá nhỏ (`512x512`, `256x256`) | Dùng `1024x1024` trở lên |
| 503 | `"auth_unavailable: no auth available"` | Backend rate limit token | Chờ vài giây rồi retry |
| — | `stream disconnected` | Gửi base64/URL thay vì upload file | Dùng multipart/form-data |
| — | Timeout | Quá nhiều reference images (>20) | Giảm xuống ≤20 |

---

## 5. Lưu Ý Stability

`gpt-image-2` sử dụng **token rotation** ở backend — sau nhiều request liên tiếp có thể trả về `auth_unavailable (503)`. Cần implement retry với delay:

```js
async function generateWithRetry(fetchFn, retries = 3, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    const res = await fetchFn();
    const data = await res.json();
    if (!data.error) return data;
    if (data.error.message?.includes('auth_unavailable') && i < retries - 1) {
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    throw new Error(data.error.message);
  }
}
```
