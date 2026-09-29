import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Button } from './Button';

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-header__title">{title}</h1>
        {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={['card', className].filter(Boolean).join(' ')}>
      {(title || actions) && (
        <header className="card__header">
          {title && <h2 className="card__title">{title}</h2>}
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      <div className="card__body">{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = 'default',
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: IconName;
  tone?: 'default' | 'success' | 'danger' | 'warning' | 'info';
}) {
  return (
    <div className={`stat stat--${tone}`}>
      {icon && (
        <div className="stat__icon">
          <Icon name={icon} size={20} />
        </div>
      )}
      <div className="stat__content">
        <div className="stat__label">{label}</div>
        <div className="stat__value">{value}</div>
        {sub && <div className="stat__sub">{sub}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon = 'box', title, message, action }: { icon?: IconName; title: ReactNode; message?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={40} />
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function Alert({ tone = 'info', children, onRetry, retryLabel }: { tone?: 'info' | 'error' | 'warning' | 'success'; children: ReactNode; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className={`alert alert--${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon name={tone === 'success' ? 'check' : tone === 'info' ? 'info' : 'alert'} />
      <div className="alert__content">{children}</div>
      {onRetry && (
        <Button size="sm" variant="secondary" icon="refresh" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

export function Badge({ tone = 'default', children }: { tone?: 'default' | 'success' | 'danger' | 'warning' | 'info'; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="table-wrap">{children}</div>;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          className={tab.value === value ? 'tabs__tab tabs__tab--active' : 'tabs__tab'}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

export function SearchBox({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div className="search-box">
      <Icon name="search" size={16} />
      <input
        className="input"
        type="search"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
