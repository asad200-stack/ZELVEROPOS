import { Link, useParams } from 'react-router';
import { IndustryGrid } from '../components/IndustryCard';
import { PosInterface } from '../components/PosInterface';
import { ProductShowcase } from '../components/ProductShowcase';
import { QuoteWizard } from '../components/QuoteWizard';
import { Section } from '../components/Section';
import { ARTICLES, HELP_CATEGORIES, articleBySlug } from '../content/help';
import { INDUSTRIES, industryBySlug } from '../content/industries';
import { FEATURES } from '../content/features';
import { Button } from '../components/Button';
import { haptic } from '../haptics';
import { playSound } from '../sound/engine';
import { useMemo, useState, type FormEvent } from 'react';
import { GlassCard } from '../components/GlassCard';
import { TrialTimeline } from '../components/TrialTimeline';
import { TRIAL_BENEFITS, validateTrial } from '../trial/model';
import { ConversionStrip } from '../components/ConversionStrip';
import { CTAS, DEMO_LIVE } from '../content/ctas';
import { PARTNER_BENEFITS, PARTNER_STEPS, PARTNER_TOOLKIT } from '../content/partners';
import { LeadCapture } from '../components/LeadCapture';
import { POS_LOGIN } from '../constants';
import { readReferral } from '../referral';
import { callSales, clearOperation, formStartedAt, operationId } from '../sales/client';
import { recoverSalesForm } from '../sales/formError';
import { readSalesContext } from '../sales/context';

export function ProductPage() {
  return (
    <Section title="ZELVERO POS" lead="A modern business operating platform for retail counters.">
      <ProductShowcase />
      <ConversionStrip />
    </Section>
  );
}

export function SolutionsPage() {
  return (
    <Section title="Solutions" lead="The same product, framed around how stores actually work.">
      <div className="zw-cards">
        {FEATURES.map((f) => (
          <GlassCard key={f.id} className="zw-feature-card" tilt>
            <h3>{f.name}</h3>
            <p>{f.summary}</p>
          </GlassCard>
        ))}
      </div>
    </Section>
  );
}

export function IndustriesPage() {
  return (
    <Section title="Industries">
      <IndustryGrid />
    </Section>
  );
}

export function IndustryPage() {
  const { slug = '' } = useParams();
  const industry = industryBySlug(slug);
  if (!industry) return <Section title="Not found">This industry page does not exist.</Section>;
  return (
    <Section title={industry.name} lead={industry.summary}>
      <ul className="zw-bullets">
        {industry.features.map((id) => (
          <li key={id}>{FEATURES.find((f) => f.id === id)?.name}</li>
        ))}
      </ul>
      <PosInterface scene={industry.features.includes('imei') ? 'inventory' : 'pos'} />
    </Section>
  );
}

export function DemoPage() {
  return (
    <Section
      title="Interactive Demo"
      lead={DEMO_LIVE ? 'Open the isolated demo environment — it never uses a real production business.' : 'Preview ZELVERO now or request a guided demo.'}
    >
      <ProductShowcase />
      <GlassCard className="zw-demo-cta">
        <div className="zw-hero__cta">
          <Link className="zw-btn zw-btn--primary" to={CTAS.preview.to}>
            {CTAS.preview.label}
          </Link>
        </div>
        <h3>Request a guided demo</h3>
        <LeadCapture source="demo_request" submitLabel="Request a Demo" title="Your demo request has been received." />
      </GlassCard>
    </Section>
  );
}

export function TrialPage() {
  const ctx = useMemo(() => readSalesContext(), []);
  const [sent, setSent] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const data = Object.fromEntries(form.entries()) as Record<string, string>;
    const next = validateTrial(data);
    setErrors(next);
    setError('');
    if (next.length) return;
    setBusy(true);
    try {
      await callSales('provisionWebsiteTrial', {
        ownerName: data.owner,
        name: data.owner,
        businessName: data.business,
        email: data.email,
        phone: data.phone,
        businessType: data.type,
        country: data.country,
        primaryCurrency: data.currency,
        password: data.password,
        interestedFeatures: ctx.interestedFeatures || [],
        referralCode: readReferral() || '',
        clientOperationId: operationId('trial'),
        formStartedAt: formStartedAt(),
      });
      clearOperation('trial');
      playSound('success');
      haptic(16);
      setSent(true);
    } catch (err) {
      const recovered = recoverSalesForm({ values: data, error: '', busy: true, completed: false }, err);
      setError(recovered.error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Start your 15-Day ZELVERO Trial" lead="No credit card required. Public signup stays closed until owner approval; staging tests use @zelvero.test addresses.">
      {sent ? (
        <div>
          <p>Your ZELVERO store is ready. Sign in to start the 15-day trial.</p>
          <a className="zw-btn zw-btn--primary" href={POS_LOGIN}>
            Enter ZELVERO
          </a>
        </div>
      ) : (
        <form className="zw-form" onSubmit={(e) => void submit(e)} noValidate>
          <TrialTimeline />
          <ul className="zw-benefits">
            {TRIAL_BENEFITS.map((item) => (
              <li key={item}>✓ {item}</li>
            ))}
          </ul>
          <label className="zw-field">
            Business Name
            <input required name="business" />
          </label>
          <label className="zw-field">
            Your Name
            <input required name="owner" />
          </label>
          <label className="zw-field">
            Email
            <input required type="email" name="email" />
          </label>
          <label className="zw-field">
            Phone
            <input required name="phone" />
          </label>
          <label className="zw-field">
            Business Type
            <select name="type" defaultValue={ctx.businessType || 'general-retail'}>
              {INDUSTRIES.map((i) => (
                <option key={i.slug} value={i.slug}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label className="zw-field">
            Country
            <input required name="country" />
          </label>
          <label className="zw-field">
            Currency
            <input required name="currency" defaultValue="USD / LBP" />
          </label>
          <label className="zw-field">
            Password
            <input required type="password" name="password" autoComplete="new-password" minLength={8} />
          </label>
          <label className="zw-hp" aria-hidden>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
          {errors.length ? <p className="zw-error">Please complete every field with a valid email and an 8+ character password.</p> : null}
          {error ? <p className="zw-error">{error}</p> : null}
          <Button type="submit" sound disabled={busy}>
            Start 15-Day Free Trial
          </Button>
        </form>
      )}
    </Section>
  );
}

export function QuotePage() {
  return (
    <Section title="Get a Quote" lead="Answer a few questions. A specialist sends your custom quotation.">
      <QuoteWizard />
    </Section>
  );
}

export function ResourcesPage() {
  return (
    <Section title="ZELVERO Academy / Help Center">
      {HELP_CATEGORIES.map((cat) => (
        <div key={cat.slug} className="zw-help-cat">
          <h3>{cat.title}</h3>
          <ul>
            {ARTICLES.filter((a) => a.category === cat.slug).map((a) => (
              <li key={a.slug}>
                <Link to={`/resources/${cat.slug}/${a.slug}`}>{a.title}</Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Section>
  );
}

export function ArticlePage() {
  const { slug = '' } = useParams();
  const article = articleBySlug(slug);
  if (!article) return <Section title="Article not found">This help article is not published yet.</Section>;
  return (
    <Section title={article.title}>
      <ol className="zw-bullets">
        {article.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </Section>
  );
}

export function PartnersPage() {
  return (
    <Section id="program" title="Grow with ZELVERO." lead="Bring businesses to ZELVERO and build recurring opportunities with a modern software platform.">
      <ol className="zw-partner-steps">
        {PARTNER_STEPS.map((s) => (
          <li key={s.n}>
            <span className="zw-eyebrow">{s.n}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="zw-cards">
        {PARTNER_BENEFITS.map((item) => (
          <GlassCard key={item} className="zw-feature-card">
            <h3>{item}</h3>
          </GlassCard>
        ))}
      </div>
      <h2>ZELVERO Partner Toolkit</h2>
      <div className="zw-cards zw-toolkit">
        {PARTNER_TOOLKIT.map((item) => (
          <GlassCard key={item.title} className="zw-feature-card">
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </GlassCard>
        ))}
      </div>
      <LeadCapture source="partner_referral" submitLabel={CTAS.partner.label} title="Thank you. We will be in touch about your partner application." />
    </Section>
  );
}

export function ContactPage() {
  return (
    <Section title="Talk to Sales" lead="Choose the path that fits. Existing stores sign in to ZELVERO POS.">
      <ConversionStrip />
      <LeadCapture source="contact" submitLabel="Send message" title="Your message has been received." />
    </Section>
  );
}

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' | 'security' }) {
  const title = kind === 'privacy' ? 'Privacy' : kind === 'terms' ? 'Terms' : 'Security';
  return (
    <Section title={title}>
      {kind === 'security' ? (
        <ul className="zw-bullets">
          <li>Cloud-hosted application</li>
          <li>Role-based access inside a store</li>
          <li>Tenant isolation between businesses</li>
          <li>Financial work processed through secured server functions</li>
          <li>Offline-safe queue that syncs when the network returns</li>
        </ul>
      ) : (
        <p className="zw-note">Full legal text will be published before public production launch.</p>
      )}
    </Section>
  );
}

export function StatusPage() {
  return (
    <Section title="Status">
      <p className="zw-note">A public status page will be published with production launch.</p>
    </Section>
  );
}

export function NotFoundPage() {
  return (
    <Section title="Page not found">
      <Link to="/">Back to ZELVERO</Link>
    </Section>
  );
}
