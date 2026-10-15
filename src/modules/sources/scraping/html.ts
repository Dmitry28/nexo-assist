import type { HTMLElement } from 'node-html-parser';

import { asText } from './next-data';

/** An element's text, entities decoded and whitespace collapsed — sites pad markup freely. */
export const elementText = (element: HTMLElement | null | undefined): string | undefined =>
  asText(element?.textContent.replace(/\s+/g, ' '));

/**
 * The path a link points to on `host`, or undefined for a malformed href. Sites mix
 * http/https and www in their own links, so an id built from the path survives that.
 */
export function linkPath(href: string | undefined, host: string): string | undefined {
  try {
    return new URL(href ?? '', `https://${host}`).pathname;
  } catch {
    return undefined;
  }
}
