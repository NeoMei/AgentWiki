const pad2 = (value: number) => String(value).padStart(2, '0');

const isoWeek = (source: Date) => {
  const date = new Date(Date.UTC(source.getFullYear(), source.getMonth(), source.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const year = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return { year, week };
};

export function interpolateDefaultPageTitle(template: string, now = new Date()): string {
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const { year, week } = isoWeek(now);
  return template
    .split('{date}').join(date)
    .split('{year}').join(String(year))
    .split('{week}').join(pad2(week));
}
