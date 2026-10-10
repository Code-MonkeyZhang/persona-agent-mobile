import type { ReactNode } from 'react';
import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';
import type { Token, Tokens } from 'marked';
import { decode } from 'html-entities';
import type { MarkedStyles } from 'react-native-marked/src/theme/types';
import type {
  ParserOptions,
  RendererInterface,
} from 'react-native-marked/src/lib/types';
import { getValidURL } from 'react-native-marked/src/utils/url';
import { getTableColAlignmentStyle } from 'react-native-marked/src/utils/table';

// Extended renderer interface with isCompleted parameter for code blocks
interface ExtendedRendererInterface extends RendererInterface {
  code(
    text: string,
    language?: string,
    containerStyle?: ViewStyle,
    textStyle?: TextStyle,
    isCompleted?: boolean
  ): ReactNode;
}

class Parser {
  private renderer: ExtendedRendererInterface;
  private styles: MarkedStyles;
  private readonly headingStylesMap: Record<number, TextStyle | undefined>;
  private readonly baseUrl: string;

  constructor(options: ParserOptions) {
    this.styles = { ...options.styles };
    this.baseUrl = options.baseUrl ?? '';
    this.renderer = options.renderer;
    this.headingStylesMap = {
      1: this.styles.h1,
      2: this.styles.h2,
      3: this.styles.h3,
      4: this.styles.h4,
      5: this.styles.h5,
      6: this.styles.h6,
    };
  }

  parse(tokens?: Token[]) {
    return this._parse(tokens);
  }

  private _parse(
    tokens: Token[] | undefined,
    styles?: ViewStyle | TextStyle | ImageStyle
  ) {
    if (!tokens) {
      return [];
    }
    const elements: ReactNode[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      elements.push(this._parseToken(token, styles));
    }
    return elements.filter((element) => element !== null);
  }

  private _parseToken(
    token: Token,
    styles?: ViewStyle | TextStyle | ImageStyle
  ): ReactNode {
    switch (token.type) {
      case 'paragraph': {
        const paragraphToken = token as Tokens.Paragraph;
        const children = this.getNormalizedSiblingNodesForBlockAndInlineTokens(
          paragraphToken.tokens ?? [],
          this.styles.text
        );

        return this.renderer.paragraph(children, this.styles.paragraph);
      }
      case 'blockquote': {
        const children = this.parse(token.tokens);
        return this.renderer.blockquote(children, this.styles.blockquote);
      }
      case 'heading': {
        // eslint-disable-next-line @typescript-eslint/no-shadow
        const styles = this.headingStylesMap[token.depth];

        if (this.hasDuplicateTextChildToken(token)) {
          return this.renderer.heading(token.text, styles, token.depth);
        }

        const children = this._parse(token.tokens, styles);
        return this.renderer.heading(children, styles, token.depth);
      }
      case 'code': {
        // Check if code block is complete (has closing fence)
        // A complete fenced code block ends with ``` or ~~~
        const raw = token.raw;
        const isCompleted =
          raw.trimEnd().endsWith('```') || raw.trimEnd().endsWith('~~~');
        return this.renderer.code(
          token.text,
          token.lang,
          this.styles.code,
          this.styles.em,
          isCompleted
        );
      }
      case 'hr': {
        return this.renderer.hr(this.styles.hr);
      }
      case 'list': {
        const listToken = token as Tokens.List;
        let startIndex = Number.parseInt(listToken.start.toString(), 10);
        if (Number.isNaN(startIndex)) {
          startIndex = 1;
        }
        const li = listToken.items.map((item) => {
          const children = item.tokens.flatMap((cItem) => {
            if (cItem.type === 'text') {
              /* getViewNode since tokens could contain a block like elements (i.e. img) */
              const childTokens = (cItem as Tokens.Text).tokens || [];
              // return this.renderer.listItem(listChildren, this.styles.li);
              return this.getNormalizedSiblingNodesForBlockAndInlineTokens(
                childTokens,
                this.styles.li
              );
            }

            /* Parse the nested token */
            return this._parseToken(cItem);
          });

          return this.renderer.listItem(children, this.styles.li);
        });

        return this.renderer.list(
          listToken.ordered,
          li,
          this.styles.list,
          this.styles.li,
          startIndex
        );
      }
      case 'escape': {
        return this.renderer.escape(token.text, {
          ...this.styles.text,
          ...styles,
        });
      }
      case 'link': {
        const linkToken = token as Tokens.Link;
        // Don't render anchors without text and children
        if (linkToken.text.trim.length < 1 && linkToken.tokens.length < 1) {
          return null;
        }

        // Note: Linking Images (https://www.markdownguide.org/basic-syntax/#linking-images) are wrapped
        // in paragraph token, so will be handled via `getNormalizedSiblingNodesForBlockAndInlineTokens`
        const linkStyle = {
          ...this.styles.link,
          ...styles,
          // To override color and fontStyle properties
          color: this.styles.link?.color,
          fontStyle: this.styles.link?.fontStyle,
        };
        const href = getValidURL(this.baseUrl, linkToken.href);

        if (this.hasDuplicateTextChildToken(linkToken)) {
          return this.renderer.link(linkToken.text, href, linkStyle);
        }

        const children = this._parse(linkToken.tokens, linkStyle);
        return this.renderer.link(children, href, linkStyle);
      }
      case 'image': {
        const imageToken = token as Tokens.Image;
        return this.renderer.image(
          imageToken.href,
          imageToken.text || imageToken.title || undefined,
          this.styles.image
        );
      }
      case 'strong': {
        const strongToken = token as Tokens.Strong;
        const boldStyle = {
          ...this.styles.strong,
          ...styles,
        };
        if (this.hasDuplicateTextChildToken(strongToken)) {
          return this.renderer.strong(strongToken.text, boldStyle);
        }

        const children = this._parse(strongToken.tokens, boldStyle);
        return this.renderer.strong(children, boldStyle);
      }
      case 'em': {
        const emToken = token as Tokens.Em;
        const italicStyle = {
          ...this.styles.em,
          ...styles,
        };
        if (this.hasDuplicateTextChildToken(emToken)) {
          return this.renderer.em(emToken.text, italicStyle);
        }

        const children = this._parse(emToken.tokens, italicStyle);
        return this.renderer.em(children, italicStyle);
      }
      case 'codespan': {
        return this.renderer.codespan(decode(token.text), {
          ...this.styles.codespan,
          ...styles,
        });
      }
      case 'br': {
        return this.renderer.br();
      }
      case 'del': {
        const delToken = token as Tokens.Del;
        const strikethroughStyle = {
          ...this.styles.strikethrough,
          ...styles,
        };
        if (this.hasDuplicateTextChildToken(delToken)) {
          return this.renderer.del(delToken.text, strikethroughStyle);
        }

        const children = this._parse(delToken.tokens, strikethroughStyle);
        return this.renderer.del(children, strikethroughStyle);
      }
      case 'text':
        return this.renderer.text(token.raw, {
          ...this.styles.text,
          ...styles,
        });
      case 'html': {
        return this.renderer.html(token.raw, {
          ...this.styles.text,
          ...styles,
        });
      }
      case 'table': {
        const tableToken = token as Tokens.Table;
        const header = tableToken.header.map((row, i) =>
          this._parse(row.tokens, {
            ...getTableColAlignmentStyle(tableToken.align[i]),
          })
        );

        const rows = tableToken.rows.map((cols) =>
          cols.map((col, i) =>
            this._parse(col.tokens, {
              ...getTableColAlignmentStyle(tableToken.align[i]),
            })
          )
        );

        return this.renderer.table(
          header,
          rows,
          this.styles.table,
          this.styles.tableRow,
          this.styles.tableCell
        );
      }
      default: {
        return null;
      }
    }
  }

  private getNormalizedSiblingNodesForBlockAndInlineTokens(
    tokens: Token[],
    textStyle?: TextStyle
  ): ReactNode[] {
    let tokenRenderQueue: Token[] = [];
    const siblingNodes: ReactNode[] = [];
    for (const t of tokens) {
      /**
       * To avoid inlining images
       * Currently supports images, link images
       * Note: to be extend for other token types
       */
      if (
        t.type === 'image' ||
        (t.type === 'link' &&
          t.tokens &&
          t.tokens[0] &&
          t.tokens[0].type === 'image')
      ) {
        // Render existing inline tokens in the queue
        const parsed = this._parse(tokenRenderQueue);
        if (parsed.length > 0) {
          siblingNodes.push(this.renderer.text(parsed, textStyle));
        }

        // Render the current block token
        if (t.type === 'image') {
          siblingNodes.push(this._parseToken(t));
        } else if (t.type === 'link') {
          const imageToken = (t.tokens ?? [])[0] as Tokens.Image;
          const href = getValidURL(this.baseUrl, t.href) ?? '';
          siblingNodes.push(
            this.renderer.linkImage(
              href,
              imageToken.href,
              imageToken.text || imageToken.title || undefined,
              this.styles.image
            )
          );
        }

        tokenRenderQueue = [];
        continue;
      }
      tokenRenderQueue = [...tokenRenderQueue, t];
    }

    /* Remaining temp tokens if any */
    if (tokenRenderQueue.length > 0) {
      siblingNodes.push(this.renderer.text(this.parse(tokenRenderQueue), {}));
    }

    return siblingNodes;
  }

  // To avoid duplicate text node nesting when there are no child tokens with text emphasis (i.e., italic)
  // ref: https://github.com/gmsgowtham/react-native-marked/issues/522
  private hasDuplicateTextChildToken(token: Token): boolean {
    if (!('tokens' in token)) {
      return false;
    }

    return !!(
      token.tokens &&
      token.tokens.length === 1 &&
      token.tokens[0]?.type === 'text'
    );
  }
}

export default Parser;
