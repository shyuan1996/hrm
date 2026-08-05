import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'div', 'p', 'br', 'strong', 'b', 'em', 'i', 'u',
  'ul', 'ol', 'li', 'blockquote', 'span', 'font'
];

const ALLOWED_ATTR = ['color', 'size'];

/** Preserve the announcement editor's formatting without trusting stored HTML. */
export const sanitizeAnnouncementHtml = (html: string): string => DOMPurify.sanitize(html, {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  ALLOW_DATA_ATTR: false
});
