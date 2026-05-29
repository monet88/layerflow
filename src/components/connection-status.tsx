import '@spectrum-web-components/button/sp-button.js';

interface ConnectionStatusValue {
  state: 'disconnected' | 'connected' | 'expired';
  expiresAt?: number;
  userId?: string;
}

interface ConnectionStatusProps {
  status: ConnectionStatusValue;
  busy?: boolean;
  onSignIn: () => void;
  onDisconnect: () => void;
}

function colorForState(state: ConnectionStatusValue['state']): string {
  switch (state) {
    case 'connected':
      return '#4caf50';
    case 'expired':
      return '#ef5350';
    default:
      return '#9e9e9e';
  }
}

function labelForStatus(status: ConnectionStatusValue): string {
  if (status.state === 'connected' && status.expiresAt) {
    const remainingMs = status.expiresAt - Date.now();
    const remainingHours = Math.max(0, Math.floor(remainingMs / (60 * 60 * 1000)));
    if (remainingHours >= 48) {
      return `Connected · expires in ${Math.floor(remainingHours / 24)} days`;
    }
    if (remainingHours >= 1) {
      return `Connected · expires in ${remainingHours} hours`;
    }
    return 'Connected · expires soon';
  }
  if (status.state === 'expired') {
    return 'Expired';
  }
  return 'Disconnected';
}

export function ConnectionStatus({
  status,
  busy = false,
  onSignIn,
  onDisconnect,
}: ConnectionStatusProps) {
  return (
    <div
      style={{
        border: '1px solid #3a3a3a',
        borderRadius: 8,
        padding: 12,
        background: '#1f1f1f',
        display: 'grid',
        gap: 8,
      }}
    >
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ color: colorForState(status.state), fontSize: 12, fontWeight: 600 }}>
          {labelForStatus(status)}
        </div>
        {status.userId && (
          <div style={{ color: '#9e9e9e', fontSize: 11 }}>Account: {status.userId}</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {(status.state === 'disconnected' || status.state === 'expired') && (
          <sp-button variant="cta" disabled={busy} onClick={onSignIn}>
            Sign In
          </sp-button>
        )}
        {status.state === 'connected' && (
          <sp-button variant="secondary" disabled={busy} onClick={onDisconnect}>
            Disconnect
          </sp-button>
        )}
      </div>
    </div>
  );
}
