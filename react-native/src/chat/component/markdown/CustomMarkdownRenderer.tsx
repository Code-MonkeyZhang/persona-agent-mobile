import React, { lazy, ReactElement, ReactNode, Suspense } from 'react';
import {
  ImageStyle,
  Platform,
  StyleSheet,
  Text,
  TextProps,
  TextStyle,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import type { RendererInterface } from 'react-native-marked';
import { Renderer } from 'react-native-marked';
import { github } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import RNFS from 'react-native-fs';
import MDSvg from 'react-native-marked/src/components/MDSvg.tsx';
import MDImage from 'react-native-marked/src/components/MDImage.tsx';

import { PressMode } from '../../../types/Chat.ts';
import MarkedList from '@jsamr/react-native-li';
import Decimal from '@jsamr/counter-style/lib/es/presets/decimal';
import Disc from '@jsamr/counter-style/lib/es/presets/disc';
import { isAndroid } from '../../../utils/PlatformUtils.ts';
import { ColorScheme, typography, monoFont } from '../../../theme/index.ts';
import CopyButton from './CopyButton.tsx';

const CustomCodeHighlighter = lazy(() => import('./CustomCodeHighlighter.tsx'));

const MemoizedCodeHighlighter = React.memo(
  ({
    text,
    language,
    colors,
    isCompleted,
  }: {
    text: string;
    language?: string;
    colors: ColorScheme;
    isCompleted?: boolean;
  }) => {
    const styles = createCustomStyles(colors);
    const textRef = React.useRef(text);
    textRef.current = text;

    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerText}>
            {language === '' ? 'code' : language}
          </Text>
          <CopyButton content={() => textRef.current} />
        </View>
        <Suspense fallback={<Text style={styles.loading}>Loading...</Text>}>
          <CustomCodeHighlighter
            hljsStyle={github}
            scrollViewProps={{
              contentContainerStyle: {
                padding: 12,
                minWidth: '100%',
                borderBottomLeftRadius: 8,
                borderBottomRightRadius: 8,
                backgroundColor: colors.codeBackground,
              },
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-expect-error
              backgroundColor: colors.codeBackground,
            }}
            textStyle={styles.text}
            language={language ?? 'code'}
            isCompleted={isCompleted}
          >
            {text}
          </CustomCodeHighlighter>
        </Suspense>
      </View>
    );
  },
  (prevProps, nextProps) => {
    if (
      prevProps.text !== nextProps.text ||
      prevProps.language !== nextProps.language ||
      prevProps.colors !== nextProps.colors
    ) {
      return false;
    }
    if (!prevProps.isCompleted && nextProps.isCompleted) {
      return false;
    }
    return true;
  }
);

export class CustomMarkdownRenderer
  extends Renderer
  implements RendererInterface
{
  private colors: ColorScheme;
  private styles: ReturnType<typeof createCustomStyles>;

  constructor(
    private onImagePress: (pressMode: PressMode, url: string) => void,
    colors: ColorScheme,
    _citations: never[] = []
  ) {
    super();
    this.colors = colors;
    this.styles = createCustomStyles(colors);
  }

  getTextView(children: string | ReactNode[], styles?: TextStyle): ReactNode {
    return (
      <Text selectable={!isAndroid} key={this.getKey()} style={styles}>
        {children}
      </Text>
    );
  }

  getNodeForTextArray(text: ReactNode[], styles?: TextStyle): ReactNode {
    if (text.length === 0) {
      return <></>;
    }
    if (text.length === 1) {
      return text[0];
    }
    return this.getTextView(text, styles);
  }

  text(text: string | ReactNode[], styles?: TextStyle): ReactNode {
    if (Array.isArray(text)) {
      return this.getNodeForTextArray(text, styles);
    }
    return this.getTextView(text, styles);
  }

  codespan(text: string, styles?: TextStyle): ReactNode {
    return this.getTextView(text, {
      ...styles,
      ...this.styles.codeSpanText,
    });
  }

  strong(children: string | ReactNode[], styles?: TextStyle): ReactNode {
    if (Array.isArray(children)) {
      return this.getNodeForTextArray(children, styles);
    }
    return this.getTextView(children, styles);
  }

  em(children: string | ReactNode[], styles?: TextStyle): ReactNode {
    if (Array.isArray(children)) {
      return this.getNodeForTextArray(children, styles);
    }
    return this.getTextView(children, styles);
  }

  br(): ReactNode {
    const text = '\n';
    return this.getTextView(text, {});
  }

  del(children: string | ReactNode[], styles?: TextStyle): ReactNode {
    if (Array.isArray(children)) {
      return this.getNodeForTextArray(children, styles);
    }
    return this.getTextView(children, styles);
  }

  heading(text: string | ReactNode[], styles?: TextStyle): ReactNode {
    if (Array.isArray(text)) {
      return this.getNodeForTextArray(text, styles);
    }
    return this.getTextView(text, styles);
  }

  escape(text: string, styles?: TextStyle): ReactNode {
    if (Array.isArray(text)) {
      return this.getNodeForTextArray(text, styles);
    }
    return this.getTextView(text, styles);
  }

  image(uri: string, alt?: string, style?: ImageStyle): ReactNode {
    const key = this.getKey();
    if (uri.endsWith('.svg')) {
      return <MDSvg uri={uri} key={key} />;
    }
    const imgUrl = uri.startsWith('http')
      ? uri
      : Platform.OS === 'ios'
      ? RNFS.DocumentDirectoryPath + '/' + uri
      : uri;
    return (
      <TouchableOpacity
        style={this.styles.imageContainer}
        activeOpacity={0.8}
        onPress={() => this.onImagePress(PressMode.Click, imgUrl)}
        onLongPress={() => this.onImagePress(PressMode.LongPress, imgUrl)}
        key={key}
      >
        <MDImage
          key={key}
          uri={imgUrl}
          alt={alt}
          style={{ ...style, ...this.styles.imageStyle }}
        />
      </TouchableOpacity>
    );
  }

  code(
    text: string,
    language?: string,
    _containerStyle?: ViewStyle,
    _textStyle?: TextStyle,
    isCompleted?: boolean
  ): ReactNode {
    if (text && text !== '') {
      return (
        <MemoizedCodeHighlighter
          key={this.getKey()}
          text={text}
          language={language}
          colors={this.colors}
          isCompleted={isCompleted}
        />
      );
    } else {
      return <></>;
    }
  }

  /**
   * 表格自绘渲染，普通 View 行列布局替代表格库与横向滚动区。
   *   滚动区嵌进裁剪气泡再嵌进虚拟列表行会构成测量反馈循环，
   *   行高随兄弟行挂载持续增长，纯 View 让高度完全由内容决定。
   */
  table(
    header: ReactNode[][],
    rows: ReactNode[][][],
    tableStyle?: ViewStyle,
    _rowStyle?: ViewStyle,
    cellStyle?: ViewStyle
  ): React.ReactNode {
    const { borderWidth, borderColor, ...tableStyleRest } = tableStyle || {};
    const line = borderWidth ?? 1;
    const edge = typeof borderColor === 'string' ? borderColor : '#d0d7de';
    const columnSeparator = (index: number) =>
      index > 0 ? { borderLeftWidth: line, borderColor: edge } : null;

    return (
      <View
        style={[
          tableStyleRest,
          this.styles.tableShell,
          {
            borderWidth: line,
            borderColor: edge,
          },
        ]}
      >
        <View style={this.styles.tableHeaderRow}>
          {header.map((headerCol, index) => {
            if (React.isValidElement(headerCol[0])) {
              const headerCell = headerCol[0] as ReactElement<TextProps>;
              headerCol[0] = React.cloneElement(headerCell, {
                style: {
                  ...headerCell.props.style,
                  fontWeight: '500',
                },
              });
            }
            return (
              <View
                key={`${index}`}
                style={[
                  cellStyle,
                  this.styles.cell,
                  this.styles.tableColumn,
                  columnSeparator(index),
                ]}
              >
                {headerCol}
              </View>
            );
          })}
        </View>
        {rows.map((rowData, index) => (
          <View
            key={`${index}`}
            style={[
              this.styles.tableRow,
              {
                borderTopWidth: line,
                borderColor: edge,
              },
            ]}
          >
            {rowData.map((cellData, cellIndex) => (
              <View
                key={`${cellIndex}`}
                style={[
                  cellStyle,
                  this.styles.cell,
                  this.styles.tableColumn,
                  columnSeparator(cellIndex),
                ]}
              >
                {cellData}
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  }

  /**
   * 列表渲染。li 数组的节点由 Parser 多个方法产出，不保证自带 key，
   * cloneElement 统一补 key 消除列表渲染的 key 告警。
   */
  list(
    ordered: boolean,
    li: ReactNode[],
    listStyle?: ViewStyle,
    textStyle?: TextStyle,
    startIndex?: number
  ): ReactNode {
    return (
      <MarkedList
        counterRenderer={ordered ? Decimal : Disc}
        markerTextStyle={textStyle}
        markerBoxStyle={listStyle}
        enableMarkerClipping={true}
        key={this.getKey()}
        startIndex={startIndex}
      >
        {li.map((node) => node)}
      </MarkedList>
    );
  }
}

const getTableWidthArr = (
  totalCols: number,
  windowWidth: number,
  windowHeight: number
) => {
  if (totalCols < 1) {
    return [];
  }

  return Array(totalCols)
    .fill(0)
    .map(() => {
      if (windowHeight > windowWidth) {
        return Math.min(Math.floor((windowWidth - 64) * (1 / 2)), 170);
      } else {
        return Math.min(Math.floor((windowWidth - 182) * (1 / 5)), 170);
      }
    });
};

const createCustomStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    text: {
      ...typography.body,
      paddingVertical: 1.3,
      fontFamily: monoFont,
      color: colors.text,
    },
    codeSpanText: {
      fontStyle: 'normal',
      backgroundColor: colors.input,
      ...typography.body,
      color: colors.text,
    },
    imageContainer: {
      marginVertical: 4,
      maxWidth: 400,
    },
    imageStyle: {
      borderRadius: 8,
    },
    container: {
      borderRadius: 8,
      overflow: 'hidden',
      backgroundColor: colors.input,
      marginVertical: 6,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.borderLight,
      borderTopLeftRadius: 8,
      borderTopRightRadius: 8,
    },
    headerText: {
      fontWeight: '500',
      paddingVertical: 8,
      paddingHorizontal: 12,
      color: colors.text,
    },
    copyButtonLayout: {
      padding: 10,
      marginLeft: 'auto',
    },
    copyButton: {
      width: 18,
      height: 18,
    },
    loading: {
      padding: 12,
      color: colors.text,
    },
    cell: {
      minHeight: 32,
    },
    /** 表格外壳的圆角与裁剪，纯 View 内容在裁剪容器内高度仍由内容决定 */
    tableShell: {
      borderRadius: 6,
      overflow: 'hidden',
    },
    /** 表头行横排加底色 */
    tableHeaderRow: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
    },
    /** 数据行横排，上边线由调用处按线宽补 */
    tableRow: {
      flexDirection: 'row',
    },
    /** 列等分气泡宽 */
    tableColumn: {
      flex: 1,
    },
  });
