import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { AIWidget } from './components/AIWidget';
import { CursorGlow } from './components/CursorGlow';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { IndustryIconLayer } from './components/IndustryCard';
import { installMagnetic } from './motion/magnetic';
import { scrollToTop, startSmoothScroll } from './motion/smooth';
import { persistReferral } from './referral';
import { HomePage } from './pages/HomePage';
import {
  ArticlePage,
  ContactPage,
  DemoPage,
  IndustriesPage,
  IndustryPage,
  LegalPage,
  NotFoundPage,
  PartnersPage,
  ProductPage,
  QuotePage,
  ResourcesPage,
  SolutionsPage,
  StatusPage,
  TrialPage,
} from './pages/SimplePages';

function ReferralCapture() {
  const { search } = useLocation();
  useEffect(() => {
    persistReferral(search);
  }, [search]);
  return null;
}

function Scroll() {
  const { pathname } = useLocation();
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
    const stopSmooth = startSmoothScroll();
    const stopMagnetic = installMagnetic();
    return () => {
      stopSmooth();
      stopMagnetic();
    };
  }, []);
  useEffect(() => {
    scrollToTop();
  }, [pathname]);
  useEffect(() => {
    const root = document.documentElement;
    const onScroll = () => {
      const y = window.scrollY;
      const max = Math.max(1, root.scrollHeight - window.innerHeight);
      root.style.setProperty('--scroll', String(y));
      root.style.setProperty('--progress', (y / max).toFixed(4));
      root.style.setProperty('--glow-y', `${18 + Math.min(y / 40, 28)}%`);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <ReferralCapture />
      <Scroll />
      <CursorGlow />
      <div className="zw-progress" aria-hidden />
      <a className="zw-skip" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/product" element={<ProductPage />} />
          <Route path="/solutions" element={<SolutionsPage />} />
          <Route path="/industries" element={<IndustriesPage />} />
          <Route path="/industries/:slug" element={<IndustryPage />} />
          <Route path="/demo" element={<DemoPage />} />
          <Route path="/quote" element={<QuotePage />} />
          <Route path="/trial" element={<TrialPage />} />
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/resources/:category/:slug" element={<ArticlePage />} />
          <Route path="/partners" element={<PartnersPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/legal/privacy" element={<LegalPage kind="privacy" />} />
          <Route path="/legal/terms" element={<LegalPage kind="terms" />} />
          <Route path="/legal/security" element={<LegalPage kind="security" />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/get-quote" element={<Navigate to="/quote" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <Footer />
      <IndustryIconLayer />
      <AIWidget />
    </BrowserRouter>
  );
}
