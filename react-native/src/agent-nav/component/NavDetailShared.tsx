/**
 * @file NavDetailShared.tsx
 * @description 工具与技能导航共用的展示件。
 *   实体图标盒、分配按钮、分组卡、状态标、详情信息行与状态四态映射在此统一样式，
 *   文档段的 markdown 渲染也收在这里供三个详情页共用。
 *   长相基准是 demo 的 NavDetailShared，页面壳由原生 Stack header 承担故不做壳组件。
 */
import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Minus, Plus, type LucideIcon } from 'lucide-react-native';
import type { MarkedStyles } from 'react-native-marked/src/theme/types.ts';
import { useTheme, ColorScheme, typography } from '../../theme/index.ts';
import type { McpServerInfo } from '../../api/server-api.ts';
import type { PressMode } from '../../types/Chat.ts';
import { ChatStatus } from '../../types/Chat.ts';
import useMarkdown from '../../chat/component/markdown/useMarkdown.ts';
import { CustomMarkdownRenderer } from '../../chat/component/markdown/CustomMarkdownRenderer.tsx';
import { CustomTokenizer } from '../../chat/component/markdown/CustomTokenizer.ts';

/**
 * MCP 状态四态直映，未连接且带 error 覆盖为红点配连接失败文案。
 * @param server 只取 status 与 error 的服务投影
 * @param colors 主题色
 * @returns 状态点颜色与文案键
 */
export function mcpStatusMeta(
  server: Pick<McpServerInfo, 'status' | 'error'>,
  colors: ColorScheme
): { color: string; labelKey: string } {
  if (server.status === 'disconnected' && server.error) {
    return { color: colors.error, labelKey: 'detail.statusError' };
  }
  const meta: Record<
    McpServerInfo['status'],
    { color: string; labelKey: string }
  > = {
    connected: { color: colors.success, labelKey: 'detail.statusConnected' },
    connecting: { color: colors.info, labelKey: 'detail.statusConnecting' },
    needs_auth: { color: colors.warning, labelKey: 'agent.needsAuth' },
    disconnected: {
      color: colors.textTertiary,
      labelKey: 'detail.statusDisconnected',
    },
  };
  return meta[server.status];
}

/**
 * 状态标：状态点与状态文案的组合，列表行副行与详情状态行共用。
 * sm 档给列表行副文案，md 档给详情信息行，颜色与文案由调用方从 mcpStatusMeta 取或直接给常量。
 */
export function StatusBadge({
  color,
  label,
  size = 'sm',
}: {
  color: string;
  label: string;
  size?: 'sm' | 'md';
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.statusRow}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <Text
        style={size === 'sm' ? styles.statusTextSm : styles.statusTextMd}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

/** 实体图标盒：有 logo 显图，缺失或加载失败显兜底图标，列表行与详情头部共用 */
export function EntityLogo({
  src,
  fallback: Fallback,
  size = 'lg',
}: {
  src?: string;
  fallback: LucideIcon;
  size?: 'sm' | 'lg';
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [failed, setFailed] = useState(false);

  /** src 变化时重置错误状态，避免上一个条目的失败态串台 */
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const boxStyle = size === 'lg' ? styles.logoLg : styles.logoSm;
  if (!src || failed) {
    return (
      <View style={[boxStyle, styles.logoFallback]}>
        <Fallback size={size === 'lg' ? 20 : 16} color={colors.primary} />
      </View>
    );
  }
  return (
    <View style={[boxStyle, styles.logoBox]}>
      <Image
        source={{ uri: src }}
        style={styles.logoImage}
        resizeMode="contain"
        onError={() => setFailed(true)}
      />
    </View>
  );
}

/** 分配池加减号：中性色方角小按钮，已分配显示减号，未分配显示加号 */
export function AssignButton({
  assigned,
  onPress,
}: {
  assigned: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <TouchableOpacity
      style={styles.assignButton}
      activeOpacity={0.5}
      onPress={onPress}
    >
      {assigned ? (
        <Minus size={14} color={colors.textSecondary} />
      ) : (
        <Plus size={14} color={colors.textSecondary} />
      )}
    </TouchableOpacity>
  );
}

/** 白底圆角卡：详情分区与列表两组共用 */
export function GroupCard({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return <View style={styles.groupCard}>{children}</View>;
}

/** 列表分组块：区标题带计数，空组给占位文案 */
export function GroupBlock({
  label,
  count,
  emptyHint,
  children,
}: {
  label: string;
  count: number;
  emptyHint: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.groupBlock}>
      <Text style={styles.groupLabel}>
        {label} · {count}
      </Text>
      <GroupCard>
        {count === 0 ? (
          <Text style={styles.groupEmpty}>{emptyHint}</Text>
        ) : (
          children
        )}
      </GroupCard>
    </View>
  );
}

/** 详情分区壳：灰字区标题悬在卡外，内容收进白底圆角卡 */
export function GroupSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.groupSection}>
      <Text style={styles.groupLabel}>{title}</Text>
      {children}
    </View>
  );
}

/**
 * 详情信息行：定宽灰色标签在左，值在右，行间分隔线由 first 标记省略首行边框。
 * 值区是容器，具体字号与富文本由调用方塞 Text 决定。
 */
export function DetailInfoRow({
  label,
  first,
  children,
}: {
  label: string;
  first?: boolean;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={[styles.infoRow, !first && styles.infoRowBorder]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <View style={styles.infoValue}>{children}</View>
    </View>
  );
}

/** 详情文档段的字号档，比聊天气泡收缩一档适配卡内阅读 */
const detailMarkedStyles: MarkedStyles = {
  h1: { ...typography.titleDisplay },
  h2: { ...typography.titleSection },
  h3: { ...typography.titleBar },
  h4: { ...typography.bodyLg },
  li: { paddingVertical: 3 },
  paragraph: { paddingVertical: 4 },
  blockquote: { marginVertical: 6 },
  table: { marginVertical: 4 },
};

/**
 * 详情页 markdown 渲染：复用聊天侧渲染链走静态渲染。
 * 直接调 useMarkdown 取元素数组后用普通 View 平铺，不走 Markdown.tsx 的 FlatList 包装，
 * 详情页外层是 ScrollView，FlatList 嵌进去会触发 VirtualizedLists 嵌套告警。
 * 图片点击与思考折叠是聊天场景的能力，这里传空实现。
 */
export function DocMarkdown({ value }: { value: string }) {
  const { colors } = useTheme();
  const renderer = useMemo(
    () =>
      new CustomMarkdownRenderer(
        (_pressMode: PressMode, _url: string) => {},
        colors,
        []
      ),
    [colors]
  );
  const tokenizer = useMemo(() => new CustomTokenizer(), []);
  const rnElements = useMarkdown(value, {
    renderer,
    tokenizer,
    styles: detailMarkedStyles,
    chatStatus: ChatStatus.Complete,
  });
  return (
    <View>
      {rnElements.map((element, i) => (
        <Fragment key={i}>{element}</Fragment>
      ))}
    </View>
  );
}

/** 共享展示件样式工厂 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    logoLg: {
      width: 38,
      height: 38,
      borderRadius: 10,
    },
    logoSm: {
      width: 32,
      height: 32,
      borderRadius: 9,
    },
    logoFallback: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySelectedBackground,
    },
    logoBox: {
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    logoImage: {
      width: '100%',
      height: '100%',
    },
    assignButton: {
      width: 27,
      height: 27,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    groupCard: {
      borderRadius: 16,
      overflow: 'hidden',
      backgroundColor: colors.card,
    },
    groupBlock: {
      marginBottom: 16,
    },
    groupSection: {
      marginBottom: 16,
    },
    groupLabel: {
      ...typography.meta,
      color: colors.textTertiary,
      marginLeft: 16,
      marginBottom: 8,
    },
    groupEmpty: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      ...typography.meta,
      color: colors.textTertiary,
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    infoRowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderLight,
    },
    infoLabel: {
      width: 64,
      flexShrink: 0,
      paddingTop: 2,
      ...typography.meta,
      color: colors.textTertiary,
    },
    infoValue: {
      flex: 1,
      minWidth: 0,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    statusDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      flexShrink: 0,
    },
    statusTextSm: {
      ...typography.caption,
      color: colors.textTertiary,
    },
    statusTextMd: {
      ...typography.content,
      color: colors.textDarkGray,
    },
  });
