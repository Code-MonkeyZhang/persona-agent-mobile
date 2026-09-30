/**
 * @file McpDetailScreen.tsx
 * @description 工具详情页，从工具列表行推入，消费 getMcpServer 的投影。
 *   头部卡放 logo 磁贴、名称与作者，基本信息卡收类型、简介与状态，
 *   状态四态直映并附错误红字，功能段只列 tool 等宽名不带描述，
 *   文档段按 markdown 渲染握手说明，未连接与待授权给占位文案。
 */
import React, { useEffect, useState } from 'react';
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
import {
  type McpServerDetail,
  type McpServerStatus,
  getMcpServer,
} from '../api/server-api.ts';
import { getServerAddress } from '../storage/StorageUtils.ts';
import { logger } from '../lib/logger';
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
 * 连接成功返回 null 由调用方渲染真实内容，待授权与未连接各给一类占位。
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
  const { name } = route.params;
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);

  const [server, setServer] = useState<McpServerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const address = getServerAddress();
    if (!address) {
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    logger.info(`[McpDetail] load: ${name}`);
    getMcpServer(address, name)
      .then((detail) => {
        setServer(detail);
        setLoadFailed(false);
      })
      .catch((e) => {
        logger.error(`[McpDetail] load failed: ${name} ${e}`);
        setLoadFailed(true);
      })
      .finally(() => setLoading(false));
  }, [name]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (loadFailed || !server) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>{t('detail.notFound')}</Text>
      </View>
    );
  }

  const isApp = Boolean(server.agentApp);
  const meta = mcpStatusMeta(server, colors);
  const toolsHint = sectionHintKind(server.status);
  const docsHint = sectionHintKind(server.status);

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.content}
    >
      {/* 头部卡：logo 磁贴加名称加作者，简介整段收进基本信息卡 */}
      <View style={styles.headerCard}>
        <EntityLogo
          src={server.logoUrl}
          fallback={isApp ? AppWindow : Wrench}
        />
        <View style={styles.headerText}>
          <Text style={styles.headerName} numberOfLines={1}>
            {server.displayName ?? server.name}
          </Text>
          {server.author ? (
            <Text style={styles.headerAuthor}>@{server.author}</Text>
          ) : null}
        </View>
      </View>

      {/* 基本信息段：类型、简介与状态，状态四态直映，错误红字并入状态行下方 */}
      <GroupSection title={t('detail.sectionBasic')}>
        <GroupCard>
          <DetailInfoRow label={t('detail.fieldType')} first>
            <Text style={styles.infoText}>
              {isApp ? t('detail.typeAgentApp') : t('detail.typeMcp')}
            </Text>
          </DetailInfoRow>
          {server.description ? (
            <DetailInfoRow label={t('detail.fieldIntro')}>
              <Text style={styles.infoIntro}>{server.description}</Text>
            </DetailInfoRow>
          ) : null}
          <DetailInfoRow label={t('detail.fieldStatus')}>
            <View style={styles.statusLine}>
              <StatusBadge
                size="md"
                color={meta.color}
                label={t(meta.labelKey)}
              />
              {server.error ? (
                <Text style={styles.errorText}>{server.error}</Text>
              ) : null}
            </View>
          </DetailInfoRow>
        </GroupCard>
      </GroupSection>

      {/* 功能段：只列等宽名，待授权、未连接与空清单给占位文案 */}
      <GroupSection title={`${t('detail.sectionTools')} · ${server.toolCount}`}>
        <GroupCard>
          {toolsHint === 'needsAuth' ? (
            <Text style={styles.hintText}>{t('detail.toolsNeedsAuth')}</Text>
          ) : toolsHint === 'unavailable' ? (
            <Text style={styles.hintText}>{t('detail.toolsUnavailable')}</Text>
          ) : !server.tools || server.tools.length === 0 ? (
            <Text style={styles.hintText}>{t('detail.toolsEmpty')}</Text>
          ) : (
            server.tools.map((tool, i) => (
              <View
                key={tool.name}
                style={[styles.toolRow, i > 0 && styles.toolRowBorder]}
              >
                <Text style={styles.toolName}>{tool.name}</Text>
              </View>
            ))
          )}
        </GroupCard>
      </GroupSection>

      {/* 文档段：握手说明按 markdown 渲染 */}
      <GroupSection title={t('detail.sectionDocs')}>
        <GroupCard>
          {docsHint === 'needsAuth' ? (
            <Text style={styles.hintText}>{t('detail.docsNeedsAuth')}</Text>
          ) : docsHint === 'unavailable' ? (
            <Text style={styles.hintText}>{t('detail.docsUnavailable')}</Text>
          ) : server.instructions ? (
            <View style={styles.docContainer}>
              <DocMarkdown value={server.instructions} />
            </View>
          ) : (
            <Text style={styles.hintText}>{t('detail.docsMissing')}</Text>
          )}
        </GroupCard>
      </GroupSection>
    </ScrollView>
  );
};

/** 工具详情页样式工厂 */
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
    infoText: {
      ...typography.content,
      color: colors.textDarkGray,
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
      borderTopWidth: StyleSheet.hairlineWidth,
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
