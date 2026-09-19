export function calculateStreak(
  checkins: Array<{ date: string; completed: boolean }>,
  habitCreatedDate: string
): number {
  if (checkins.length === 0) return 0;

  const sorted = checkins
    .sort(
      (a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
    )
    .filter((c) => c.completed);

  if (sorted.length === 0) return 0;

  let streak = 0;
  let currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);

  for (const checkin of sorted) {
    const checkinDate = new Date(checkin.date);
    checkinDate.setHours(0, 0, 0, 0);

    const diffTime = currentDate.getTime() - checkinDate.getTime();
    const diffDays = diffTime / (1000 * 60 * 60 * 24);

    if (diffDays <= streak + 1) {
      streak++;
      currentDate = checkinDate;
    } else {
      break;
    }
  }

  return streak;
}

export function getDateRange(daysBack: number = 30) {
  const dates = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    date.setHours(0, 0, 0, 0);
    dates.push(date);
  }
  return dates;
}

export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

export function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

export function daysUntilResetStreak(lastCheckinDate: string): number {
  const lastDate = new Date(lastCheckinDate);
  lastDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffTime = today.getTime() - lastDate.getTime();
  const diffDays = diffTime / (1000 * 60 * 60 * 24);

  return Math.max(0, 1 - diffDays);
}
