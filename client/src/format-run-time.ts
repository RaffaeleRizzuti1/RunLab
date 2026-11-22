export function formatTime(seconds: number, showHours = false): string {
  const rounded = Math.round(seconds);
  const hours = showHours ? Math.floor(rounded / 3_600) : 0;
  const minutes = Math.floor((rounded - hours * 3_600) / 60);
  const secondsPart = String(rounded % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${secondsPart}`
    : `${minutes}:${secondsPart}`;
}
