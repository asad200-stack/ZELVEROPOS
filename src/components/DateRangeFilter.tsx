import { presetRange, type DatePreset, type DateRange } from '@/domain/dates';
import { useI18n, type TranslationKey } from '@/i18n/i18n';

const PRESETS: { value: DatePreset; label: TranslationKey }[] = [
  { value: 'today', label: 'date.today' },
  { value: 'yesterday', label: 'date.yesterday' },
  { value: 'week', label: 'date.week' },
  { value: 'month', label: 'date.month' },
  { value: 'lastMonth', label: 'date.lastMonth' },
  { value: 'year', label: 'date.year' },
  { value: 'custom', label: 'date.custom' },
];

export function DateRangeFilter({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const { t } = useI18n();
  return (
    <div className="date-range">
      <select
        className="input"
        value={value.preset}
        onChange={(e) => {
          const preset = e.target.value as DatePreset;
          onChange(preset === 'custom' ? { ...value, preset } : { preset, ...presetRange(preset) });
        }}
        aria-label={t('date.range')}
      >
        {PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {t(p.label)}
          </option>
        ))}
      </select>
      {value.preset === 'custom' && (
        <>
          <input
            className="input"
            dir="ltr"
            type="date"
            value={value.from}
            max={value.to}
            onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
            aria-label={t('date.from')}
          />
          <input
            className="input"
            dir="ltr"
            type="date"
            value={value.to}
            min={value.from}
            onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
            aria-label={t('date.to')}
          />
        </>
      )}
    </div>
  );
}
