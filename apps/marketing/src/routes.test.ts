import { describe, expect, it } from 'vitest';
import { articleBySlug } from './content/help';
import { industryBySlug } from './content/industries';
import { MAIN_ROUTES } from './routes';

describe('navigation', () => {
  it('lists every public marketing route', () => {
    expect(MAIN_ROUTES).toContain('/');
    expect(MAIN_ROUTES).toContain('/quote');
    expect(MAIN_ROUTES).toContain('/trial');
    expect(MAIN_ROUTES).toContain('/partners');
  });

  it('rejects invalid industry and resource slugs', () => {
    expect(industryBySlug('not-a-store')).toBeUndefined();
    expect(articleBySlug('missing')).toBeUndefined();
    expect(industryBySlug('mobile-electronics')?.name).toMatch(/Mobile/);
  });
});
