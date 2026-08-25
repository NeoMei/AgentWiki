import { describe, expect, it } from 'vitest';
import { interpolateDefaultPageTitle } from './defaultPageTitle';

describe('interpolateDefaultPageTitle', () => {
  const now = new Date(2026, 7, 25, 12, 0, 0);

  it('uses local YYYY-MM-DD and ISO week tokens', () => {
    expect(interpolateDefaultPageTitle('日报 {date}', now)).toBe('日报 2026-08-25');
    expect(interpolateDefaultPageTitle('周报 {year}年第{week}周', now)).toBe('周报 2026年第35周');
    expect(interpolateDefaultPageTitle('Weekly {year}-W{week}', now)).toBe('Weekly 2026-W35');
  });

  it('leaves custom titles without recognized tokens unchanged', () => {
    expect(interpolateDefaultPageTitle('Team {name}', now)).toBe('Team {name}');
  });

  it('replaces every repeated recognized token in the same title', () => {
    expect(interpolateDefaultPageTitle(
      '{date}|{date}|{year}|{year}|{week}|{week}',
      now,
    )).toBe('2026-08-25|2026-08-25|2026|2026|35|35');
  });

  it('uses the ISO week-year at calendar-year boundaries', () => {
    expect(interpolateDefaultPageTitle('{date} {year}-W{week}', new Date(2025, 11, 29, 12)))
      .toBe('2025-12-29 2026-W01');
    expect(interpolateDefaultPageTitle('{date} {year}-W{week}', new Date(2021, 0, 1, 12)))
      .toBe('2021-01-01 2020-W53');
  });

  it('keeps local calendar dates stable across daylight-saving transition dates', () => {
    expect(interpolateDefaultPageTitle('{date} {year}-W{week}', new Date(2026, 2, 8, 23, 30)))
      .toBe('2026-03-08 2026-W10');
    expect(interpolateDefaultPageTitle('{date} {year}-W{week}', new Date(2026, 10, 1, 0, 30)))
      .toBe('2026-11-01 2026-W44');
  });
});
