/**
 * @file McpDetailScreen.tsx
 * @description 外部工具详情页，从工具列表行推入，数据读注册表清单，mcp 与 app 同构。
 *   手机端对连接动作只读，授权与重连都在桌面端完成，这里不放任何动作按钮。
 *   头部卡放 logo 磁贴、名称与作者，基本信息卡收简介与四态状态并附错误红字，
 *   功能段只列等宽短名不带描述，文档段按 markdown 渲染条目说明，
 *   未就绪的段按状态给占位文案。
 */
import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppWindow, Wrench } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, ColorScheme } from '../theme/index.ts';
import { RouteParamList } from '../types/RouteTypes.ts';
import type { McpServerStatus } from '../api/server-api.ts';
import { useToolsStore } from '../stores/toolsStore.ts';
import {
  DetailInfoRow,
  DocMarkdown,
  EntityLogo,
  GroupCard,
  GroupSection,
  mcpStatusMeta,
  StatusBadge,
} from './component/NavDetailShared.tsx';
import { typography, monoFont } from '../theme/index.ts';

type Props = NativeStackScreenProps<RouteParamList, 'McpDetail'>;

/**
 * 按展示状态取区块占位文案的类别。
 * 连接成功返回 null 由调用方渲染真实内容，待授权与未就绪各给一类占位。
 */
function sectionHintKind(
  status: McpServerStatus
): 'needsAuth' | 'unavailable' | null {
  if (status === 'connected') {
    return null;
  }
  return status === 'needs_auth' ? 'needsAuth' : 'unavailable';
}

const McpDetailScreen: React.FC<Props> = ({ route }) => {
  const { id } = route.params;
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);

  const entries = useToolsStore((s) => s.entries);

  const entry = entries?.find((e) => e.id === id);

  if (!entries) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!entry) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>{t('detail.notFound')}</Text>
      </View>
    );
  }

  const meta = mcpStatusMeta(entry.status, colors);
  const hint = sectionHintKind(entry.status);

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.content}
    >
      {/* 头部卡：logo 磁贴加名称加作者，简介整段收进基本信息卡 */}
      <View style={styles.headerCard}>
        <EntityLogo
          src={entry.logoUrl}
          fallback={entry.kind === 'app' ? AppWindow : Wrench}
        />
        <View style={styles.headerText}>
          <Text style={styles.headerName} numberOfLines={1}>
            {entry.name}
          </Text>
          {entry.author ? (
            <Text style={styles.headerAuthor}>@{entry.author}</Text>
          ) : null}
        </View>
      </View>

      {/* 基本信息段：简介与状态，状态四态直映，错误红字并入状态行下方 */}
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
            <View style={styles.statusLine}>
              <StatusBadge
                size="md"
                color={meta.color}
                label={t(meta.labelKey)}
              />
              {entry.error ? (
                <Text style={styles.errorText}>{entry.error}</Text>
              ) : null}
            </View>
          </DetailInfoRow>
        </GroupCard>
      </GroupSection>

      {/* 功能段：只列等宽短名，待授权、未就绪与空清单给占位文案 */}
      <GroupSection
        title={`${t('detail.sectionTools')} · ${entry.functions.length}`}
      >
        <GroupCard>
          {hint === 'needsAuth' ? (
            <Text style={styles.hintText}>{t('detail.toolsNeedsAuth')}</Text>
          ) : hint === 'unavailable' ? (
            <Text style={styles.hintText}>{t('detail.toolsUnavailable')}</Text>
          ) : entry.functions.length === 0 ? (
            <Text style={styles.hintText}>{t('detail.toolsEmpty')}</Text>
          ) : (
            entry.functions.map((fn, i) => (
              <View
                key={fn.name}
                style={[styles.toolRow, i > 0 && styles.toolRowBorder]}
              >
                <Text style={styles.toolName}>{fn.shortName}</Text>
              </View>
            ))
          )}
        </GroupCard>
      </GroupSection>

      {/* 文档段：条目说明按 markdown 渲染，未就绪按状态给占位文案 */}
      <GroupSection title={t('detail.sectionDocs')}>
        <GroupCard>
          {hint === 'needsAuth' ? (
            <Text style={styles.hintText}>{t('detail.docsNeedsAuth')}</Text>
          ) : hint === 'unavailable' ? (
            <Text style={styles.hintText}>{t('detail.docsUnavailable')}</Text>
          ) : entry.instructions ? (
            <View style={styles.docContainer}>
              <DocMarkdown value={entry.instructions} />
            </View>
          ) : (
            <Text style={styles.hintText}>{t('detail.docsMissing')}</Text>
          )}
        </GroupCard>
      </GroupSection>
    </ScrollView>
  );
};

/** 外部工具详情页样式工厂 */
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
    headerText: {
      flex: 1,
      minWidth: 0,
    },
    headerName: {
      ...typography.titleBar,
      fontWeight: '600',
      color: colors.text,
    },
    headerAuthor: {
      marginTop: 2,
      ...typography.tertiary,
      color: colors.textTertiary,
    },
    infoIntro: {
      ...typography.meta,
      color: colors.textDarkGray,
    },
    statusLine: {
      gap: 4,
      alignItems: 'flex-start',
    },
    errorText: {
      ...typography.caption,
      color: colors.error,
    },
    hintText: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      ...typography.meta,
      color: colors.textTertiary,
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

export default McpDetailScreen;
