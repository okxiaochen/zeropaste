import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Class name helper expected by the generated components in src/components/ui. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
