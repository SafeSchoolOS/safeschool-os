import { describe, it, expect } from 'vitest';
import { stripHtml, escapeHtml, sanitizeText, isValidDateString } from '../utils/sanitize.js';

describe('sanitize utilities', () => {
  describe('stripHtml', () => {
    it('removes script tags', () => {
      expect(stripHtml('<script>alert("xss")</script>')).toBe('alert("xss")');
    });

    it('removes img tags with event handlers', () => {
      expect(stripHtml('<img src=x onerror=alert(1)>')).toBe('');
    });

    it('removes nested tags', () => {
      expect(stripHtml('<div><p>Hello</p></div>')).toBe('Hello');
    });

    it('preserves plain text', () => {
      expect(stripHtml('Hello World')).toBe('Hello World');
    });

    it('handles empty input', () => {
      expect(stripHtml('')).toBe('');
    });

    it('strips partial tags', () => {
      expect(stripHtml('text<script')).toBe('text');
    });
  });

  describe('escapeHtml', () => {
    it('escapes angle brackets', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    it('escapes ampersands', () => {
      expect(escapeHtml('A & B')).toBe('A &amp; B');
    });

    it('escapes quotes', () => {
      expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
    });

    it('escapes single quotes', () => {
      expect(escapeHtml("it's")).toBe('it&#x27;s');
    });
  });

  describe('sanitizeText', () => {
    it('strips HTML and trims', () => {
      expect(sanitizeText('  <b>Hello</b>  ')).toBe('Hello');
    });

    it('returns empty string for null/undefined', () => {
      expect(sanitizeText(null)).toBe('');
      expect(sanitizeText(undefined)).toBe('');
    });

    it('strips XSS payload from visitor name', () => {
      const xss = '<img src=x onerror=alert(1)>';
      expect(sanitizeText(xss)).toBe('');
    });

    it('strips script injection from alert message', () => {
      const xss = 'Fire in <script>steal(cookie)</script> hallway';
      expect(sanitizeText(xss)).toBe('Fire in steal(cookie) hallway');
    });
  });

  describe('isValidDateString', () => {
    it('accepts valid ISO date', () => {
      expect(isValidDateString('2024-01-15')).toBe(true);
    });

    it('accepts full ISO datetime', () => {
      expect(isValidDateString('2024-01-15T10:30:00Z')).toBe(true);
    });

    it('rejects SQL injection string', () => {
      expect(isValidDateString("'; DROP TABLE visitors;--")).toBe(false);
    });

    it('rejects random text', () => {
      expect(isValidDateString('not-a-date')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidDateString('')).toBe(false);
    });
  });
});
