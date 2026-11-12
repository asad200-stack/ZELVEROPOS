export const TRIAL_JOURNEY = [
  { day: 'DAY 1', title: 'Set up your business' },
  { day: 'DAY 5', title: 'Start selling' },
  { day: 'DAY 10', title: 'Explore reports' },
  { day: 'DAY 15', title: 'Choose your plan' },
] as const;

export function TrialTimeline() {
  return (
    <ol className="zw-trial-ring" aria-label="15-day trial journey">
      {TRIAL_JOURNEY.map((item) => (
        <li key={item.day}>
          <span>{item.day}</span>
          <strong>{item.title}</strong>
        </li>
      ))}
    </ol>
  );
}
