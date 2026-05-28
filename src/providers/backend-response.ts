export class ProviderResponseError extends Error {
  constructor(message: string, public readonly payloadPreview?: string) {
    super(message);
    this.name = 'ProviderResponseError';
  }
}

export interface ImageEditsItem {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
}

export interface ImageEditsResponse {
  data: ImageEditsItem[];
}

export function assertImageEditsResponse(raw: unknown): ImageEditsResponse {
  if (typeof raw !== 'object' || raw === null) {
    throw new ProviderResponseError('Backend returned a non-object response.', preview(raw));
  }

  const data = (raw as Record<string, unknown>).data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new ProviderResponseError('Backend response missing a non-empty data array.', preview(raw));
  }

  const first = data[0];
  if (typeof first !== 'object' || first === null) {
    throw new ProviderResponseError('Backend response data[0] is not an object.', preview(raw));
  }

  const item = first as ImageEditsItem;
  const hasB64 = typeof item.b64_json === 'string' && item.b64_json.length > 0;
  const hasUrl = typeof item.url === 'string' && item.url.length > 0;
  if (!hasB64 && !hasUrl) {
    throw new ProviderResponseError(
      'Backend response data[0] is missing both b64_json and url.',
      preview(raw),
    );
  }

  return { data: data as ImageEditsItem[] };
}

function preview(raw: unknown): string {
  try {
    const json = JSON.stringify(raw);
    return json.length > 240 ? `${json.slice(0, 240)}…` : json;
  } catch {
    return '<unserializable>';
  }
}
