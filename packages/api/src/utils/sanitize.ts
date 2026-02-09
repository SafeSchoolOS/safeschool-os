/**
 * Input sanitization utilities for XSS prevention.
 * Strips HTML tags and dangerous attributes from user input.
 */

const HTML_TAG_RE = /<\/?[^>]+(>|$)/g;
const HTML_ENTITY_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
};

/**
 * Strip all HTML tags from a string.
 * Use for fields that should never contain markup (names, messages, etc.).
 */
export function stripHtml(input: string): string {
  return input.replace(HTML_TAG_RE, '').trim();
}

/**
 * Escape HTML entities in a string.
 * Use when the content may be rendered in HTML but should not contain active markup.
 */
export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => HTML_ENTITY_MAP[char] || char);
}

/**
 * Sanitize a text field: strip HTML tags and trim.
 * Returns the cleaned string.
 */
export function sanitizeText(input: string | undefined | null): string {
  if (!input) return '';
  return stripHtml(input);
}

/**
 * Validate an ISO date string. Returns true if valid, false otherwise.
 */
export function isValidDateString(input: string): boolean {
  const d = new Date(input);
  return !isNaN(d.getTime());
}
