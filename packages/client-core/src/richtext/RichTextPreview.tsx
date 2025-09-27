import {memo} from 'react';

import type {NodeRecord} from '../types';
import {htmlToPlainText} from '../utils/text';

interface RichTextPreviewProps {
  readonly node: NodeRecord;
  readonly className?: string;
}

/**
 * Renders sanitised HTML for inactive outline nodes. The markup mirrors the
 * active editor's schema output so virtualization keeps layout stable.
 */
export const RichTextPreview = memo(({node, className}: RichTextPreviewProps) => {
  const {html} = node;
  const isEmpty = html.trim().length === 0;
  const plain = htmlToPlainText(html);

  return (
    <div
      className={className}
      role="textbox"
      aria-readonly="true"
      aria-label={`Node ${node.id}`}
      style={{whiteSpace: 'pre-wrap'}}
    >
      {isEmpty ? <span style={{color: '#9ca3af'}}>{plain || 'Empty'}</span> : (
        <span dangerouslySetInnerHTML={{__html: html}} />
      )}
    </div>
  );
});
