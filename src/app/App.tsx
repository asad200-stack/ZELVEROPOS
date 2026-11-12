import { useState, type ReactNode } from 'react';
import { BrowserRouter } from 'react-router';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { FeedbackProvider } from '@/components/feedback/FeedbackProvider';
import { Button } from '@/components/ui/Button';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { SessionProvider } from '@/contexts/SessionProvider';
import { getFirebase } from '@/firebase/app';
import { FirebaseConfigError } from '@/firebase/config';
import { I18nProvider } from '@/i18n/I18nProvider';
import { useI18n } from '@/i18n/i18n';
import { APP_NAME } from '@/constants/app';
import { AiConversationLifecycle } from '@/features/ai/AiConversationLifecycle';
import { PosPreviewPage } from '@/features/pos/PosPreviewPage';
import { AppRoutes } from './AppRoutes';

function CrashScreen({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return (
    <div className="center-screen">
      <div className="center-card">
        <h1>{t('error.crashTitle')}</h1>
        <p className="muted">{t('error.crashMessage')}</p>
        {import.meta.env.DEV && <pre className="code-block">{error.message}</pre>}
        <div className="row-gap">
          <Button onClick={reset}>{t('common.retry')}</Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            {t('common.reload')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConfigErrorScreen({ error }: { error: unknown }) {
  const { t } = useI18n();
  const problems = error instanceof FirebaseConfigError ? error.problems.map((p) => p.message) : [String((error as Error)?.message ?? error)];
  return (
    <div className="center-screen">
      <div className="center-card">
        <h1>{APP_NAME}</h1>
        <h2>{t('config.title')}</h2>
        <p className="muted">{t('config.message')}</p>
        <ul className="problem-list">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="muted small">{t('config.hint')}</p>
      </div>
    </div>
  );
}

/** Initialises Firebase once; refuses to render the app with a missing/unsafe configuration. */
function FirebaseGate({ children }: { children: ReactNode }) {
  const [error] = useState<unknown>(() => {
    try {
      getFirebase();
      return null;
    } catch (e) {
      console.error('[firebase] configuration rejected', e);
      return e;
    }
  });
  if (error) return <ConfigErrorScreen error={error} />;
  return <>{children}</>;
}

export function App() {
  const preview =
    import.meta.env.VITE_APP_CHANNEL === 'preview' && window.location.pathname.startsWith('/preview');
  if (preview) {
    return (
      <ThemeProvider>
        <I18nProvider>
          <PosPreviewPage />
        </I18nProvider>
      </ThemeProvider>
    );
  }
  return (
    <ThemeProvider>
      <I18nProvider>
        <ErrorBoundary fallback={(error, reset) => <CrashScreen error={error} reset={reset} />}>
          <FeedbackProvider>
            <FirebaseGate>
              <SessionProvider>
                <AiConversationLifecycle />
                <BrowserRouter basename={import.meta.env.BASE_URL === '/' ? undefined : String(import.meta.env.BASE_URL).replace(/\/$/, '')}>
                  <AppRoutes />
                </BrowserRouter>
              </SessionProvider>
            </FirebaseGate>
          </FeedbackProvider>
        </ErrorBoundary>
      </I18nProvider>
    </ThemeProvider>
  );
}
