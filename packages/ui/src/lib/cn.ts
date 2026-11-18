import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const merge = extendTailwindMerge({
  extend: { theme: { spacing: ['page', 'panel', 'touch'] } },
});

/** Merge class names; later Tailwind utilities win over earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}
