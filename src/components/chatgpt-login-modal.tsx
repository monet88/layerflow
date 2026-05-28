import { useEffect, useRef, useState } from 'react';
import '@spectrum-web-components/button/sp-button.js';

declare const require: (module: 'uxp') => {
  shell: {
    openExternal(url: string): Promise<void>;
  };
};
import {
  exchangeAuthorizationCode,
  getDeviceAuthHelpUrl,
  pollForAuthorizationCode,
  startDeviceAuth,
} from '../auth/codex-device-code';
import type { DeviceAuthSession, StoredChatGptTokens } from '../auth/oauth-types';
import { disconnectChatGpt, storeChatGptTokens } from '../auth/token-manager';

interface ChatGptLoginModalProps {
  onClose: () => void;
  onAuthorized: (tokens: StoredChatGptTokens) => Promise<void> | void;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function ChatGptLoginModal({ onClose, onAuthorized }: ChatGptLoginModalProps) {
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<DeviceAuthSession | null>(null);
  const [phase, setPhase] = useState<'starting' | 'waiting' | 'finishing' | 'error'>('starting');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setSession(null);
    setPhase('starting');
    setError(null);
    setCopied(false);

    void (async () => {
      try {
        const nextSession = await startDeviceAuth(controller.signal);
        if (controller.signal.aborted) return;
        setSession(nextSession);
        setPhase('waiting');

        const grant = await pollForAuthorizationCode(nextSession, controller.signal);
        if (controller.signal.aborted) return;
        setPhase('finishing');

        const tokens = await exchangeAuthorizationCode(grant, controller.signal);
        const stored = await storeChatGptTokens(tokens);
        try {
          await onAuthorized(stored);
          onClose();
        } catch (error) {
          await disconnectChatGpt();
          throw error;
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setPhase('error');
        setError(getErrorMessage(error));
      }
    })();

    return () => {
      controller.abort();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [attempt, onAuthorized, onClose]);

  const handleCancel = (): void => {
    controllerRef.current?.abort();
    onClose();
  };

  const handleRetry = (): void => {
    controllerRef.current?.abort();
    setAttempt((value) => value + 1);
  };

  const handleCopy = async (): Promise<void> => {
    if (!session) return;
    await navigator.clipboard.writeText(session.userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const handleOpenBrowser = async (): Promise<void> => {
    const { shell } = require('uxp');
    await shell.openExternal(session?.verificationUri ?? getDeviceAuthHelpUrl());
  };

  const statusMessage =
    phase === 'finishing'
      ? 'Finishing sign in…'
      : phase === 'error'
        ? 'Sign in failed.'
        : session
          ? 'Waiting for authorization…'
          : 'Preparing sign in…';

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 10,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 360,
          background: '#1e1e1e',
          border: '1px solid #3a3a3a',
          borderRadius: 12,
          padding: 16,
          display: 'grid',
          gap: 12,
        }}
      >
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>Sign in to ChatGPT</div>
          <div style={{ color: '#bdbdbd', fontSize: 11 }}>
            Enable Device code authorization for Codex in ChatGPT Security settings, then
            enter the code below.
          </div>
        </div>

        <div
          style={{
            border: '1px solid #3a3a3a',
            borderRadius: 8,
            padding: '14px 12px',
            background: '#121212',
            color: '#fff',
            fontFamily: 'monospace',
            fontSize: 22,
            letterSpacing: 2,
            textAlign: 'center',
            minHeight: 54,
          }}
        >
          {session?.userCode ?? '--------'}
        </div>

        <div style={{ color: '#9e9e9e', fontSize: 12 }}>{statusMessage}</div>
        {error && <div style={{ color: '#ef5350', fontSize: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <sp-button variant="secondary" disabled={!session} onClick={() => void handleCopy()}>
            {copied ? 'Copied' : 'Copy Code'}
          </sp-button>
          <sp-button variant="cta" onClick={() => void handleOpenBrowser()}>
            Open ChatGPT
          </sp-button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <sp-button variant="secondary" onClick={handleCancel}>
            Cancel
          </sp-button>
          <sp-button variant="secondary" onClick={handleRetry}>
            Retry
          </sp-button>
        </div>
      </div>
    </div>
  );
}
