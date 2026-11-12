import { Link } from 'react-router';
import { CreditStory } from '../components/CreditStory';
import { DemoCTA } from '../components/DemoCTA';
import { FeatureCard } from '../components/FeatureCard';
import { Hero } from '../components/Hero';
import { IndustryGrid } from '../components/IndustryCard';
import { OfflineStory } from '../components/OfflineStory';
import { ProductShowcase } from '../components/ProductShowcase';
import { QuoteWizard } from '../components/QuoteWizard';
import { ScrollStage } from '../components/ScrollStage';
import { Section } from '../components/Section';
import { TrialTimeline } from '../components/TrialTimeline';
import { WhyZelvero } from '../components/WhyZelvero';
import { CTAS } from '../content/ctas';
import { FEATURES, VALUE_STRIP } from '../content/features';
import { playSound } from '../sound/engine';

export function HomePage() {
  return (
    <>
      <Hero />
      <div className="zw-marquee" aria-label="Capabilities">
        <div className="zw-marquee__track">
          {[0, 1].map((copy) => (
            <div className="zw-marquee__group" key={copy} aria-hidden={copy === 1 ? true : undefined}>
              {VALUE_STRIP.map((item) => (
                <span key={item}>
                  {item}
                  <i aria-hidden>✦</i>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div id="stage">
        <ScrollStage />
      </div>
      <WhyZelvero />
      <Section id="product" title="One system for the work that runs the store." lead="See the ZELVERO POS — then the rest of the business around it.">
        <ProductShowcase />
      </Section>
      <Section
        id="credit"
        eyebrow="Customer credit"
        title="Collect today’s sale and previous customer debt from one checkout."
        lead="ZELVERO records the new sale and old debt collection separately."
      >
        <CreditStory />
      </Section>
      <Section
        id="offline"
        title="Internet down? Keep selling."
        lead="ZELVERO is designed to keep key POS work available during connectivity problems and synchronize safely when the connection returns."
      >
        <OfflineStory />
      </Section>
      <Section id="industries" title="Built for how you actually sell.">
        <IndustryGrid />
      </Section>
      <Section id="demo">
        <DemoCTA />
      </Section>
      <Section id="trial" title="Start your 15-Day ZELVERO Trial" lead="No credit card required.">
        <TrialTimeline />
        <Link className="zw-btn zw-btn--primary" to={CTAS.trialLong.to} onClick={() => playSound('primary')}>
          {CTAS.trialLong.label}
        </Link>
      </Section>
      <Section id="quote" title="Get a Quote" lead="Answer a few questions. A specialist sends your custom quotation.">
        <QuoteWizard />
      </Section>
      <Section id="partner" title="Grow with ZELVERO." lead="Bring businesses to ZELVERO and build recurring opportunities with a modern software platform.">
        <Link className="zw-btn zw-btn--primary" to={CTAS.partner.to}>
          {CTAS.partner.label}
        </Link>
      </Section>
      <Section title="What changes in the business">
        <div className="zw-cards">
          {FEATURES.slice(0, 6).map((f) => (
            <FeatureCard key={f.id} feature={f} />
          ))}
        </div>
      </Section>
    </>
  );
}
