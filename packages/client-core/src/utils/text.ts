const HTML_ENTITY_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

const HTML_ENTITY_REGEX = /[&<>"']/g;
const BR_TAG_REGEX = /<br\s*\/?>(?![^<]*>)/gi;
const TAG_REGEX = /<[^>]*>/g;
const AMP_ENTITY_REGEX = /&(?:amp|lt|gt|quot|#39);/g;

const decodeEntity = (entity: string): string => {
  switch (entity) {
    case '&lt;':
      return '<';
    case '&gt;':
      return '>';
    case '&quot;':
      return '"';
    case '&#39;':
      return "'";
    case '&amp;':
    default:
      return '&';
  }
};

export const plainTextToHtml = (value: string): string => {
  const escaped = value.replace(HTML_ENTITY_REGEX, (char) => HTML_ENTITY_MAP[char]);
  return escaped.replace(/\n/g, '<br />');
};

export const htmlToPlainText = (value: string): string => {
  if (!value) {
    return '';
  }

  const withLineBreaks = value.replace(BR_TAG_REGEX, '\n');
  const withoutTags = withLineBreaks.replace(TAG_REGEX, '');
  return withoutTags.replace(AMP_ENTITY_REGEX, (entity) => decodeEntity(entity));
};

