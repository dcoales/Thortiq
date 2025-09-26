/**
 * Wiki rendering
 *
 * Lightweight HTML renderers for wiki links. These helpers return strings and
 * do not perform DOM mutations or interact with Yjs directly.
 */
import {plainTextToHtml} from '../utils/text';
import type {NodeId} from '../types';
import type {WikiLinkId, WikiLinkRenderOptions, WikiLinkToken} from './types';
import {replaceWikiLinks} from './parse';

export interface RenderedWikiLinkSpan {
  readonly html: string;
  readonly linkId: WikiLinkId | null;
  readonly targetNodeId: NodeId | null;
}

export const renderWikiLinkSpan = (
  display: string,
  targetNodeId: NodeId,
  options?: WikiLinkRenderOptions
): string => {
  const safeText = plainTextToHtml(display);
  const dataAttrs = options?.dataAttrs ?? {};
  const attrs = Object.entries(dataAttrs)
    .map(([k, v]) => ` data-${k}="${String(v)}"`)
    .join('');
  const className = options?.className ? ` class="${options.className}"` : '';
  const idAttr = options?.linkId ? ` data-wikilink-id="${options.linkId}"` : '';
  const style = ' style="text-decoration: underline; cursor: pointer; color: #2563eb;"';
  return `<span data-wikilink="true" data-target-node-id="${targetNodeId}"${idAttr}${className}${attrs}${style}>${safeText}</span>`;
};

export interface TextWithWikiLinksRenderOptions {
  readonly resolveTarget: (targetText: string) => NodeId | null; // pure resolver supplied by caller
  readonly buildId?: () => WikiLinkId; // optional id factory
  readonly className?: string;
}

export const renderTextWithWikiLinks = (
  text: string,
  options: TextWithWikiLinksRenderOptions
): {html: string; links: ReadonlyArray<RenderedWikiLinkSpan>} => {
  const links: RenderedWikiLinkSpan[] = [];
  const {text: html, replaced} = replaceWikiLinks(text, (tok: WikiLinkToken) => {
    const target = options.resolveTarget(tok.targetText);
    const displayText = tok.display.length > 0 ? tok.display : tok.targetText;
    if (!target) {
      // Render unresolved links as styled spans as well; omit target id.
      return renderWikiLinkSpan(displayText, '' as unknown as NodeId, {
        className: options.className
      });
    }
    const linkId = options.buildId?.() ?? null;
    const span = renderWikiLinkSpan(displayText, target, {
      linkId: linkId ?? undefined,
      className: options.className
    });
    links.push({html: span, linkId, targetNodeId: target});
    return span;
  });

  // If nothing was replaced, still return HTML-escaped text for consistency
  const finalHtml = replaced > 0 ? html : plainTextToHtml(text);
  return {html: finalHtml, links};
};
