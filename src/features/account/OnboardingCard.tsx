import { useState } from 'react';
import { Link } from 'react-router';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Layout';
import { useSession, useTenant } from '@/contexts/session';
import { firebase } from '@/firebase/app';
import { useI18n } from '@/i18n/i18n';

export function OnboardingCard() {
  const { t } = useI18n();
  const { tenantId, isOwner } = useTenant();
  const { writesEnabled, subscription } = useSession();
  const [skipped, setSkipped] = useState(false);
  if (!isOwner || !writesEnabled || skipped || subscription?.source !== 'website') return null;

  const skip = async () => {
    setSkipped(true);
    await setDoc(
      doc(firebase.db, 'tenants', tenantId, 'onboarding', 'main'),
      { skipped: true, dismissedWelcome: true, updatedAt: serverTimestamp() },
      { merge: true },
    );
  };

  return (
    <Card title={t('onboarding.welcome')}>
      <ol className="stack">
        <li>✓ {t('onboarding.businessCreated')}</li>
        <li>
          ○ <Link to="/products">{t('onboarding.addProduct')}</Link>
        </li>
        <li>
          ○ <Link to="/pos">{t('onboarding.firstSale')}</Link>
        </li>
      </ol>
      <Button variant="ghost" size="sm" onClick={() => void skip()}>
        {t('onboarding.skip')}
      </Button>
    </Card>
  );
}
