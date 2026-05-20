import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// Catches render-time exceptions in the React tree so a crashing component cannot leave the
// panel blank. Production builds report through console; in dev the message is shown so the
// developer notices.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('InpaintKit: render error', error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          padding: 16,
          color: '#fff',
          fontSize: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <strong style={{ fontSize: 13 }}>Something went wrong</strong>
        <span style={{ color: '#ddd' }}>{this.state.error.message}</span>
        <button
          type="button"
          onClick={this.reset}
          style={{
            alignSelf: 'flex-start',
            background: '#2680eb',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Click to restart
        </button>
      </div>
    );
  }
}
