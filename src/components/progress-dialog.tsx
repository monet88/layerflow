import '@spectrum-web-components/progress-circle/sp-progress-circle.js';
import '@spectrum-web-components/button/sp-button.js';

interface ProgressDialogProps {
  message: string;
  onCancel: () => void;
}

export function ProgressDialog({ message, onCancel }: ProgressDialogProps) {
  return (
    <div className="dialog-container" style={{ alignItems: 'center', paddingTop: 32 }}>
      <sp-progress-circle size="l" indeterminate></sp-progress-circle>
      <p style={{ color: '#fff', fontSize: 13, marginTop: 12 }}>{message}</p>
      <sp-button variant="secondary" onClick={onCancel}>
        Cancel
      </sp-button>
    </div>
  );
}
