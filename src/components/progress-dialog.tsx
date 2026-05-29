import '@spectrum-web-components/progress-circle/sp-progress-circle.js';
import '@spectrum-web-components/button/sp-button.js';
import type { ProgressStage, ProgressUpdate } from '../services/generation-service';
import type { GenerationMode } from '../types/ui-state';

interface ProgressDialogProps {
  mode: GenerationMode;
  progress: ProgressUpdate;
  canCancel?: boolean;
  isPlacementRetry?: boolean;
  onCancel: () => void;
}

const GENERATE_STAGES: { stage: ProgressStage; label: string }[] = [
  { stage: 'preparing', label: 'Prepare' },
  { stage: 'generating', label: 'Generate' },
  { stage: 'placing', label: 'Place' },
  { stage: 'done', label: 'Done' },
];

const INPAINT_STAGES: { stage: ProgressStage; label: string }[] = [
  { stage: 'preparing', label: 'Prepare' },
  { stage: 'exporting', label: 'Export' },
  { stage: 'uploading', label: 'Upload' },
  { stage: 'generating', label: 'Generate' },
  { stage: 'placing', label: 'Place' },
  { stage: 'done', label: 'Done' },
];

const PLACEMENT_RETRY_STAGES: { stage: ProgressStage; label: string }[] = [
  { stage: 'placing', label: 'Retry placement' },
  { stage: 'done', label: 'Done' },
];

function stageStatus(
  stages: { stage: ProgressStage; label: string }[],
  stage: ProgressStage,
  activeIndex: number,
): string {
  const index = stages.findIndex((item) => item.stage === stage);
  if (index < activeIndex) return '✓';
  if (index === activeIndex) return '•';
  return '○';
}

export function ProgressDialog({
  mode,
  progress,
  canCancel = true,
  isPlacementRetry = false,
  onCancel,
}: ProgressDialogProps) {
  const stages = isPlacementRetry
    ? PLACEMENT_RETRY_STAGES
    : mode === 'generate'
      ? GENERATE_STAGES
      : INPAINT_STAGES;
  const activeIndex = Math.max(
    0,
    stages.findIndex((item) => item.stage === progress.stage),
  );

  return (
    <div className="dialog-container" style={{ alignItems: 'center', paddingTop: 24 }}>
      <sp-progress-circle
        size="l"
        indeterminate
        aria-label={`${progress.message} ${Math.round(progress.percent)} percent`}
      ></sp-progress-circle>
      <div role="status" aria-live="polite" style={{ color: '#fff', fontSize: 13, marginTop: 8 }}>
        {progress.message}
      </div>
      <div style={{ color: '#9e9e9e', fontSize: 11 }}>{Math.round(progress.percent)}%</div>

      <div style={{ width: '100%', display: 'grid', gap: 6, marginTop: 8 }}>
        {stages.map((item) => (
          <div
            key={item.stage}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              color: item.stage === progress.stage ? '#fff' : '#8a8a8a',
              fontSize: 11,
            }}
          >
            <span>{item.label}</span>
            <span>{stageStatus(stages, item.stage, activeIndex)}</span>
          </div>
        ))}
      </div>

      <sp-button variant="secondary" onClick={onCancel} disabled={!canCancel}>
        Cancel
      </sp-button>
    </div>
  );
}
