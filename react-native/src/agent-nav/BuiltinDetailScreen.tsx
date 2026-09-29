/**
 * @file BuiltinDetailScreen.tsx
 * @description 内置工具详情页，从工具列表的内置行推入，数据源是本地常量不请求服务端。
 *   头部卡放图标与名称，基本信息卡收类型、简介与常绿的连接状态，
 *   功能卡只列等宽名，文档卡渲染内置 markdown 文档。
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useTheme, ColorScheme } from '../theme/index.ts';
import { RouteParamList } from '../types/RouteTypes.ts';
import { logger } from '../lib/logger';
import { BUILT_IN_TOOLS } from './builtInTools.ts';
import {
  DetailInfoRow,
  DocMarkdown,
  GroupCard,
  GroupSection,
  monoFont,
  StatusBadge,
} from './component/NavDetailShared.tsx';

type Props = NativeStackScreenProps<RouteParamList, 'BuiltinDetail'>;

const BuiltinDetailScreen: React.FC<Props> = ({ route }) => {
  const { id } = route.params;
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);

  const tool = BUILT_IN_TOOLS.find((x) => x.id === id);

  if (!tool) {
    logger.warn(`[BuiltinDetail] unknown builtin id: ${id}`);
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>{t('detail.notFound')}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.content}
    >
      {/* 头部卡：图标盒加名称 */}
      <View style={styles.headerCard}>
        <View style={styles.headerIconBox}>
          <tool.icon size={20} color={colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.headerName} numberOfLines={1}>
            {tool.name}
          </Text>
        </View>
      </View>

      {/* 基本信息段：类型、简介与常绿的连接状态 */}
      <GroupSection title={t('detail.sectionBasic')}>
        <GroupCard>
          <DetailInfoRow label={t('detail.fieldType')} first>
            <Text style={styles.infoText}>{t('detail.typeBuiltin')}</Text>
          </DetailInfoRow>
          <DetailInfoRow label={t('detail.fieldIntro')}>
            <Text style={styles.infoIntro}>{tool.desc}</Text>
          </DetailInfoRow>
          <DetailInfoRow label={t('detail.fieldStatus')}>
            <StatusBadge
              size="md"
              color={colors.success}
              label={t('detail.statusConnected')}
            />
          </DetailInfoRow>
        </GroupCard>
      </GroupSection>

      {/* 功能段：只列等宽名 */}
      <GroupSection
        title={`${t('detail.sectionTools')} · ${tool.tools.length}`}
      >
        <GroupCard>
          {tool.tools.map((item, i) => (
            <View
              key={item.name}
              style={[styles.toolRow, i > 0 && styles.toolRowBorder]}
            >
              <Text style={styles.toolName}>{item.name}</Text>
            </View>
          ))}
        </GroupCard>
      </GroupSection>

      {/* 文档段：内置文档按 markdown 渲染 */}
      <GroupSection title={t('detail.sectionDocs')}>
        <GroupCard>
          <View style={styles.docContainer}>
            <DocMarkdown value={tool.instructions} />
          </View>
        </GroupCard>
      </GroupSection>
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
      fontSize: 15,
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
      fontSize: 17,
      fontWeight: '600',
      color: colors.text,
    },
    infoText: {
      fontSize: 14,
      lineHeight: 21,
      color: colors.textDarkGray,
    },
    infoIntro: {
      fontSize: 13,
      lineHeight: 21,
      color: colors.textDarkGray,
    },
    toolRow: {
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    toolRowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderLight,
    },
    toolName: {
      fontSize: 13,
      color: colors.textDarkGray,
      fontFamily: monoFont,
    },
    docContainer: {
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
  });

export default BuiltinDetailScreen;
