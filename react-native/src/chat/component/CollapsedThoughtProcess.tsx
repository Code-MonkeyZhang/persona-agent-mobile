/**
 * @file CollapsedThoughtProcess.tsx
 * @description 消息内思考过程，与顶栏时间线同一套行语言。
 *   - 入口透明无底色，文案恒为思考过程不带步数，失败不改色
 *   - 展开后是带框面板，身份图标加自然语言动向句，竖向连线把步骤串起来
 *   - 行纯展示两行截断不可点，详情弹层只在桌面端
 *   - props 保持 steps 与 onToggle 契约不变，展开时量高回调供宿主做滚动补偿
 */
import React, { memo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ChevronRight, Lightbulb, XCircle } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { Thought } from '../../types/Thought';
import { phraseForThought, toolIcon, ROW_ICON, FAIL_RED } from './LiveStrip';
import { useTheme, typography } from '../../theme';

interface CollapsedThoughtProcessProps {
  steps: Thought[];
  onToggle?: (expanded: boolean, height: number, animated: boolean) => void;
}

/** 面板内竖向连线色，取自设计文档与桌面实现 */
const CONNECTOR = '#c3cfdf';

/**
 * 单条步骤行，与时间线的行语言同构
 * 前置位身份图标，工具行走自然语言动向句，思考行走正文灰不斜体
 * 失败行整句红字紧跟 circle-x，末行不垂线
 */
const ThoughtItem = memo(function ({
  thought,
  isLast,
}: {
  thought: Thought;
  isLast: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();

  const isTool = thought.type === 'tool_use';
  const isErrorType = thought.type === 'error';
  const isFailed = isTool && !!(thought.isError || thought.toolResult?.isError);
  const Icon = isTool
    ? toolIcon(thought.toolName || '')
    : isErrorType
    ? XCircle
    : Lightbulb;
  const iconColor = isErrorType || isFailed ? FAIL_RED : ROW_ICON;
  const summary = phraseForThought(t, thought);
  const textColor = isErrorType || isFailed ? FAIL_RED : colors.textSecondary;

  return (
    <View style={styles.itemRow}>
      {!isLast && <View style={styles.connector} />}
      <Icon size={11} color={iconColor} />
      {isFailed ? (
        // 失败行主文字不撑满整行，标记贴着文字尾部
        <View style={styles.failRow}>
          <Text style={[styles.rowText, { color: FAIL_RED }]} numberOfLines={2}>
            {summary}
          </Text>
          <XCircle size={11} color={FAIL_RED} />
        </View>
      ) : (
        <Text style={[styles.rowText, { color: textColor }]} numberOfLines={2}>
          {summary}
        </Text>
      )}
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

  // text 行由气泡正文承担不进面板，与时间线同一过滤口径
  const visible = steps.filter((th) => th.type !== 'text');
  if (visible.length === 0) {
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
        style={styles.entryBtn}
        activeOpacity={0.6}
        onPress={handleToggle}
      >
        <ChevronRight
          size={11}
          color={colors.textTertiary}
          style={{
            transform: [{ rotate: isExpanded ? '90deg' : '0deg' }],
          }}
        />
        <Text style={[styles.entryText, { color: colors.textSecondary }]}>
          {t('thought.entry')}
        </Text>
      </TouchableOpacity>

      {isExpanded && (
        <View
          ref={panelRef}
          style={[
            styles.panel,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          onLayout={(e) => {
            panelHeightRef.current = e.nativeEvent.layout.height;
          }}
        >
          <ScrollView style={styles.scroll}>
            {visible.map((thought, index) => (
              <ThoughtItem
                key={`${thought.id}-${index}`}
                thought={thought}
                isLast={index === visible.length - 1}
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
    marginTop: 6,
    marginBottom: 6,
    marginLeft: 2,
  },
  entryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  entryText: {
    ...typography.caption,
  },
  panel: {
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 8,
    maxHeight: 250,
    overflow: 'hidden',
  },
  scroll: {
    paddingHorizontal: 12,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingTop: 4,
    paddingBottom: 12,
    paddingLeft: 4,
    paddingRight: 4,
  },
  rowText: {
    flex: 1,
    ...typography.caption,
  },
  failRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  connector: {
    position: 'absolute',
    left: 9,
    top: 17,
    bottom: -4,
    width: 1.5,
    borderRadius: 1,
    backgroundColor: CONNECTOR,
  },
});

export default memo(CollapsedThoughtProcess);
