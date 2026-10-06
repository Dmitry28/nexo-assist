import type { HTMLElement } from 'node-html-parser';

import { asText } from './next-data';

/** An element's text, entities decoded and whitespace collapsed — sites pad markup freely. */
export const elementText = (element: HTMLElement | null | undefined): string | undefined =>
  asText(element?.textContent.replace(/\s+/g, ' '));
