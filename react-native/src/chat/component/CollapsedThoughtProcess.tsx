/**
 * @file CollapsedThoughtProcess.tsx
 * @description 结构化思考过程时间线组件。折叠时显示按钮，展开后显示带图标的步骤列表。
 *              基础版：图标 + 标签 + 2 行截断展开 + 整体折叠。
 */
import React, { memo, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { ChevronRight, CheckCircle, AlertTriangle } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { Thought } from '../../types/Thought';
import {
  getThoughtIcon,
  getThoughtColor,
  getThoughtLabel,
  getToolFriendlyFormat,
} from '../util/thought-utils';
import { useTheme, type ColorScheme } from '../../theme';

interface CollapsedThoughtProcessProps {
  steps: Thought[];
  /** 整体展开/收起时的滚动补偿回调 */
  onToggle?: (expanded: boolean, height: number, animated: boolean) => void;
}

/** 单个思考步骤的时间线节点 */
const ThoughtItem = memo(function ThoughtItem({
  thought,
  isLast,
  colors,
}: {
  thought: Thought;
  isLast: boolean;
  colors: ColorScheme;
}) {
  const { t } = useTranslation();
  const [isContentExpanded, setIsContentExpanded] = useState(false);
  const [lineCount, setLineCount] = useState(0);
  const needsExpand = lineCount > 2;

  const isError = !!thought.toolResult?.isError;
  const hasToolResult = thought.type === 'tool_use' && !!thought.toolResult;
  const color = getThoughtColor(thought.type, isError, colors);
  const Icon = getThoughtIcon(thought.type);
  const label = getThoughtLabel(thought.type);
  const headerColor = isError ? colors.warning : color;
  const circleBg = isError ? colors.warningBackground : colors.surface;
  const circleStyle = [styles.circle, { backgroundColor: circleBg }];
  const headerStyle = [styles.header, { color: headerColor }];
  const contentStyle = [styles.content, { color: colors.textSecondary }];
  const thinkingContentStyle = [
    styles.content,
    { fontStyle: 'italic' as const, color: colors.textTertiary },
  ];

  const content =
    thought.type === 'tool_use'
      ? getToolFriendlyFormat(thought.toolName || '', thought.toolInput)
      : thought.content || '';

  return (
    <View style={styles.itemRow}>
      {/* 时间线：圆形图标 + 竖线连接 */}
      <View style={styles.timelineColumn}>
        <View style={circleStyle}>
          {hasToolResult ? (
            isError ? (
              <AlertTriangle size={17} color={colors.warning} />
            ) : (
              <CheckCircle size={17} color={colors.success} />
            )
          ) : (
            <Icon size={17} color={color} />
          )}
        </View>
        {!isLast && (
          <View
            style={[styles.connector, { backgroundColor: colors.border }]}
          />
        )}
      </View>

      {/* 内容：标签 + 正文 */}
      <View style={[styles.contentColumn, isLast && styles.contentColumnLast]}>
        <Text style={headerStyle}>
          {thought.toolName ? `${label} - ${thought.toolName}` : label}
        </Text>
        {content.length > 0 && (
          <View style={styles.bodyRow}>
            <Text
              style={
                thought.type === 'thinking'
                  ? thinkingContentStyle
                  : contentStyle
              }
              numberOfLines={isContentExpanded ? undefined : 2}
              onTextLayout={(e) => setLineCount(e.nativeEvent.lines.length)}
            >
              {content}
            </Text>
            {needsExpand && (
              <TouchableOpacity
                style={styles.expandBtn}
                onPress={() => setIsContentExpanded(!isContentExpanded)}
              >
                <Text style={[styles.expandBtnText, { color: colors.info }]}>
                  {isContentExpanded
                    ? t('thought.collapse')
                    : t('thought.expand')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </View>
  );
});

/** 折叠的思考过程展示组件 */
function CollapsedThoughtProcess({
  steps,
  onToggle,
}: CollapsedThoughtProcessProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [isExpanded, setIsExpanded] = useState(false);
  const panelRef = useRef<View>(null);
  const panelHeightRef = useRef(0);

  if (steps.length === 0) {
    return null;
  }

  const handleToggle = () => {
    if (isExpanded) {
      setIsExpanded(false);
      onToggle?.(false, panelHeightRef.current, false);
    } else {
      setIsExpanded(true);
      setTimeout(() => {
        panelRef.current?.measure((_x, _y, _w, height) => {
          panelHeightRef.current = height;
          onToggle?.(true, height, true);
        });
      }, 150);
    }
  };

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        style={[styles.collapsedBtn, { backgroundColor: colors.surface }]}
        activeOpacity={0.6}
        onPress={handleToggle}
      >
        <ChevronRight
          size={15}
          color={colors.textTertiary}
          style={{
            transform: [{ rotate: isExpanded ? '90deg' : '0deg' }],
          }}
        />
        <Text style={[styles.collapsedLabel, { color: colors.textSecondary }]}>
          {t('thought.showThinking')}
        </Text>
      </TouchableOpacity>

      {isExpanded && (
        <View
          ref={panelRef}
          style={[styles.panel, { backgroundColor: colors.surface }]}
          onLayout={(e) => {
            panelHeightRef.current = e.nativeEvent.layout.height;
          }}
        >
          <ScrollView style={styles.scroll}>
            {steps.map((thought, index) => (
              <ThoughtItem
                key={`${thought.id}-${index}`}
                thought={thought}
                isLast={index === steps.length - 1}
                colors={colors}
              />
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 6,
    marginLeft: 2,
  },
  collapsedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  collapsedLabel: {
    fontSize: 14,
  },
  panel: {
    marginTop: 4,
    paddingVertical: 8,
    borderRadius: 8,
    maxHeight: 250,
  },
  scroll: {
    paddingHorizontal: 10,
  },
  itemRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 4,
  },
  timelineColumn: {
    flexDirection: 'column',
    alignItems: 'center',
  },
  circle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: {
    width: 2,
    flex: 1,
    marginTop: 4,
    minHeight: 8,
  },
  contentColumn: {
    flex: 1,
    paddingBottom: 12,
  },
  contentColumnLast: {
    paddingBottom: 0,
  },
  header: {
    fontSize: 14,
    fontWeight: '500',
  },
  bodyRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginTop: 2,
  },
  content: {
    flex: 1,
    fontSize: 14,
  },
  expandBtn: {
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  expandBtnText: {
    fontSize: 14,
  },
});

export default memo(CollapsedThoughtProcess);
