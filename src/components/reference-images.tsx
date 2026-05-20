import '@spectrum-web-components/button/sp-button.js';
import '@spectrum-web-components/action-button/sp-action-button.js';

interface ReferenceImagesProps {
  paths: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
}

export function ReferenceImages({ paths, onAdd, onRemove }: ReferenceImagesProps) {
  return (
    <div>
      <div className="section-label">Reference Images (optional)</div>
      {paths.map((p, i) => (
        <div
          key={i}
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
          >
            {p.split('/').pop()}
          </span>
          <sp-action-button size="s" onClick={() => onRemove(i)}>✕</sp-action-button>
        </div>
      ))}
      <sp-button variant="secondary" size="s" onClick={onAdd}>
        Add Reference Image
      </sp-button>
    </div>
  );
}
