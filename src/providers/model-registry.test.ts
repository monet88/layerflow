import { describe, expect, it } from 'vitest';
import { ProviderError } from './provider-interface';
import {
  getModelDefinition,
  listModels,
  providerIdForModel,
  resolveEndpoint,
} from './model-registry';

describe('model-registry', () => {
  it('exposes ChatGPT GPT Image 2 as both generate and inpaint capable', () => {
    const model = getModelDefinition('gpt-image-2-chatgpt');

    expect(model.providerId).toBe('chatgpt-backend');
    expect(model.capabilities).toEqual(['generate', 'inpaint']);
    expect(model.supportsReferenceImages).toBe(false);
    expect(resolveEndpoint(model.id, 'generate')).toBe('gpt-image-2');
    expect(resolveEndpoint(model.id, 'inpaint')).toBe('gpt-image-2');
  });

  it('keeps UI-facing model ids discoverable', () => {
    const ids = listModels().map((model) => model.id);

    expect(ids).toEqual(expect.arrayContaining([
      'flux-fill-pro',
      'nano-banana-2',
      'gpt-image-2',
      'gpt-image-2-chatgpt',
      'nano-banana-pro',
      'seedream-5-lite',
    ]));
    expect(providerIdForModel('nano-banana-pro')).toBe('replicate');
  });

  it('throws typed provider errors for unknown models and unsupported capabilities', () => {
    expect(() => getModelDefinition('unknown')).toThrow(ProviderError);
    expect(() => resolveEndpoint('flux-fill-pro', 'generate')).toThrow(ProviderError);
  });
});
