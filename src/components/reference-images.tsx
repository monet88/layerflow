import '@spectrum-web-components/button/sp-button.js';
import '@spectrum-web-components/action-button/sp-action-button.js';
import type { ReferenceImage } from '../types/ui-state';

const MAX_REFERENCE_IMAGES = 3;

interface ReferenceImagesProps {
  images: ReferenceImage[];
  onAdd: () => void;
  onRemove: (index: number) => void;
}

export function ReferenceImages({ images, onAdd, onRemove }: ReferenceImagesProps) {
  const limitReached = images.length >= MAX_REFERENCE_IMAGES;
  return (
    <div>
      <div className="section-label">Reference Images (optional)</div>
      {images.map((img, i) => (
        <div
          key={`${img.name}-${i}`}
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}
        >
          <span
            style={{
              flex: 1,
              fontSize: 11,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={img.name}
          >
            {img.name}
          </span>
          <sp-action-button size="s" onClick={() => onRemove(i)} title="Remove">
            ✕
          </sp-action-button>
        </div>
      ))}
      <sp-button variant="secondary" size="s" onClick={onAdd} disabled={limitReached}>
        {limitReached ? `Max ${MAX_REFERENCE_IMAGES} reached` : 'Add Reference Image'}
      </sp-button>
    </div>
  );
}
