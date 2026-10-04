import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Formats a problem's `month` column ("YYYY-MM-DD", always the 1st) as e.g.
// "October 2026". Parsed by hand: `new Date("2026-10-01")` is UTC midnight,
// which renders as the previous month in US time zones.
export function formatProblemMonth(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Date(year, monthIndex - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}
