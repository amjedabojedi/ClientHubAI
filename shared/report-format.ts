// Shared helper to tidy up rich-text report HTML for display and export.
//
// AI-generated reports (and the prompt templates that produce them) insert an
// empty paragraph (`<p><br></p>`) directly after every section heading and
// between paragraphs. That empty paragraph shows up as a large blank gap
// between a section title and its text. This normalizer removes those redundant
// empty paragraphs so titles sit tight against their content, while leaving the
// real content untouched. It is a pure string transform (no DOM needed) so it
// can run in the browser and on the server.

const EMPTY_P = '<p\\b[^>]*>(?:\\s|&nbsp;|<br\\s*/?>)*</p>';

export function normalizeReportHtml(html?: string | null): string {
  if (!html) return '';
  let out = html;

  // 1) Remove empty paragraph(s) immediately after a heading (the title→text gap).
  out = out.replace(new RegExp(`(</h[1-6]>)\\s*(?:${EMPTY_P}\\s*)+`, 'gi'), '$1');

  // 2) Collapse runs of 2+ consecutive empty paragraphs into a single blank line.
  out = out.replace(new RegExp(`(?:${EMPTY_P}\\s*){2,}`, 'gi'), '<p><br></p>');

  // 3) Drop any empty paragraph(s) at the very start of the content.
  out = out.replace(new RegExp(`^\\s*(?:${EMPTY_P}\\s*)+`, 'i'), '');

  return out;
}
