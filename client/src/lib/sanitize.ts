import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitizes HTML content from rich text editors to prevent XSS attacks.
 * Uses a strict allowlist of safe tags and attributes.
 * 
 * @param html - The HTML content to sanitize
 * @returns Sanitized HTML safe for rendering
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br',
      'strong', 'em', 'u',
      'ol', 'ul', 'li',
      'blockquote',
      'a'
    ],
    ALLOWED_ATTR: [
      'href',
      'target',
      'rel'
    ],
    // Ensure links open safely
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    // Add rel="noopener noreferrer" to external links
    ADD_ATTR: ['target'],
  });
}
