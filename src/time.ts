export const isoNow = (now = new Date()): string => now.toISOString();

export const addMinutes = (date: Date, minutes: number): Date =>
  new Date(date.getTime() + minutes * 60_000);

export const addMilliseconds = (date: Date, ms: number): Date =>
  new Date(date.getTime() + ms);

export const randomScheduledDate = (
  now: Date,
  delayWindowMinutes: number,
  random: () => number = Math.random
): Date => {
  const maxMs = Math.max(0, delayWindowMinutes) * 60_000;
  return addMilliseconds(now, Math.floor(random() * maxMs));
};

