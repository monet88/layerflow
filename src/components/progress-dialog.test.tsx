import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProgressDialog } from './progress-dialog';

describe('ProgressDialog', () => {
  it('renders inpaint pipeline stages and handles cancellation', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <ProgressDialog
        mode="inpaint"
        progress={{ stage: 'uploading', percent: 45, message: 'Uploading mask...' }}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Uploading mask...');
    expect(screen.getByText('45%')).toBeInTheDocument();
    expect(screen.getByText('Prepare')).toBeInTheDocument();
    expect(screen.getByText('Export')).toBeInTheDocument();
    expect(screen.getByText('Upload')).toBeInTheDocument();
    expect(screen.getByText('Generate')).toBeInTheDocument();
    expect(screen.getByText('Place')).toBeInTheDocument();

    await user.click(screen.getByText('Cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders placement retry as a short placing-only flow', () => {
    render(
      <ProgressDialog
        mode="generate"
        isPlacementRetry
        canCancel={false}
        progress={{ stage: 'placing', percent: 80, message: 'Retrying placement...' }}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Retrying placement...');
    expect(screen.getByText('Retry placement')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.queryByText('Generate')).not.toBeInTheDocument();
  });
});
