/**
 * @file BuiltinDetailScreen.tsx
 * @description 内置工具详情页，从工具列表的内置行推入，数据读注册表清单。
 *   头部卡放图标与名称，行尾开关写分配端点与列表行联动，
 *   基本信息卡收简介与常绿的连接状态，
 *   功能卡只列等宽短名，文档卡渲染条目自带的 markdown 说明。
 */
import React from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useTheme, ColorScheme } from '../theme/index.ts';
import { RouteParamList } from '../types/RouteTypes.ts';
import { useToolsStore } from '../stores/toolsStore.ts';
import { logger } from '../lib/logger';
import { BUILTIN_ICONS, BUILTIN_ICON_FALLBACK } from './builtInTools.ts';
import {
  DetailInfoRow,
  DocMarkdown,
  GroupCard,
  GroupSection,
  StatusBadge,
} from './component/NavDetailShared.tsx';
import { typography, monoFont } from '../theme/index.ts';

type Props = NativeStackScreenProps<RouteParamList, 'BuiltinDetail'>;

const BuiltinDetailScreen: React.FC<Props> = ({ route }) => {
  const { id } = route.params;
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);

  const entries = useToolsStore((s) => s.entries);
  const toggleAssignment = useToolsStore((s) => s.toggleAssignment);
  const assigning = useToolsStore((s) => s.assigning);

  const entry = entries?.find((e) => e.id === id);

  if (!entry) {
    logger.warn(`[BuiltinDetail] entry not in registry: ${id}`);
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>{t('detail.notFound')}</Text>
      </View>
    );
  }

  const Icon = BUILTIN_ICONS[id] ?? BUILTIN_ICON_FALLBACK;
  const disabled = entry.assigned === false;

  /** 行尾开关切换分配记录，目标态由 store 读最新清单态取反，本页不再计算 */
  const toggle = () => {
    toggleAssignment(id);
  };

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.content}
    >
      {/* 头部卡：图标盒加名称，行尾开关写分配记录 */}
      <View style={styles.headerCard}>
        <View style={styles.headerIconBox}>
          <Icon size={20} color={colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.headerName} numberOfLines={1}>
            {entry.name}
          </Text>
        </View>
        <Switch
          value={!disabled}
          onValueChange={toggle}
          disabled={assigning.has(id)}
          trackColor={{ false: colors.border, true: colors.primary }}
        />
      </View>

      {/* 基本信息段：简介与常绿的连接状态 */}
      <GroupSection title={t('detail.sectionBasic')}>
        <GroupCard>
          {entry.description ? (
            <DetailInfoRow label={t('detail.fieldIntro')} first>
              <Text style={styles.infoIntro}>{entry.description}</Text>
            </DetailInfoRow>
          ) : null}
          <DetailInfoRow
            label={t('detail.fieldStatus')}
            first={!entry.description}
          >
            <StatusBadge
              size="md"
              color={colors.success}
              label={t('detail.statusConnected')}
            />
          </DetailInfoRow>
        </GroupCard>
      </GroupSection>

      {/* 功能段：只列等宽短名 */}
      <GroupSection
        title={`${t('detail.sectionTools')} · ${entry.functions.length}`}
      >
        <GroupCard>
          {entry.functions.map((fn, i) => (
            <View
              key={fn.name}
              style={[styles.toolRow, i > 0 && styles.toolRowBorder]}
            >
              <Text style={styles.toolName}>{fn.shortName}</Text>
            </View>
          ))}
        </GroupCard>
      </GroupSection>

      {/* 文档段：条目自带说明按 markdown 渲染 */}
      {entry.instructions ? (
        <GroupSection title={t('detail.sectionDocs')}>
          <GroupCard>
            <View style={styles.docContainer}>
              <DocMarkdown value={entry.instructions} />
            </View>
          </GroupCard>
        </GroupSection>
      ) : null}
    </ScrollView>
  );
};

/** 内置工具详情页样式工厂 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.surface,
    },
    scrollView: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    content: {
      padding: 16,
      paddingBottom: 40,
    },
    emptyText: {
      ...typography.body,
      color: colors.textTertiary,
    },
    headerCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderRadius: 16,
      backgroundColor: colors.card,
      marginBottom: 16,
    },
    headerIconBox: {
      width: 38,
      height: 38,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySelectedBackground,
      flexShrink: 0,
    },
    headerText: {
      flex: 1,
      minWidth: 0,
    },
    headerName: {
      ...typography.titleBar,
      fontWeight: '600',
      color: colors.text,
    },
    infoIntro: {
      ...typography.meta,
      color: colors.textDarkGray,
    },
    toolRow: {
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    toolRowBorder: {
      borderTopWidth: 1,
      borderTopColor: colors.borderLight,
    },
    toolName: {
      ...typography.meta,
      color: colors.textDarkGray,
      fontFamily: monoFont,
    },
    docContainer: {
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
  });

export default BuiltinDetailScreen;
