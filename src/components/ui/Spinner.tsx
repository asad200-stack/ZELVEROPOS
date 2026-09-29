export function Spinner({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <span className="spinner" style={{ width: size, height: size }} role={label ? 'status' : undefined} aria-label={label} />
  );
}

export function PageLoader({ label }: { label?: string }) {
  return (
    <div className="page-loader">
      <Spinner size={32} label={label} />
    </div>
  );
}
