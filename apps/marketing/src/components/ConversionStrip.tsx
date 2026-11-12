import { Link } from 'react-router';
import { CTAS } from '../content/ctas';

export function ConversionStrip() {
  return (
    <div className="zw-hero__cta zw-convert">
      <Link className="zw-btn zw-btn--primary" to={CTAS.trial.to}>
        {CTAS.trial.label}
      </Link>
      <Link className="zw-btn zw-btn--secondary" to={CTAS.demo.to}>
        {CTAS.demo.label}
      </Link>
      <Link className="zw-btn zw-btn--secondary" to={CTAS.quote.to}>
        {CTAS.quote.label}
      </Link>
      <Link className="zw-btn zw-btn--ghost" to={CTAS.sales.to}>
        {CTAS.sales.label}
      </Link>
      <Link className="zw-btn zw-btn--ghost" to={CTAS.partner.to}>
        {CTAS.partner.label}
      </Link>
    </div>
  );
}
