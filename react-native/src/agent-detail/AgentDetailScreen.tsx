/**
 * @file AgentDetailScreen.tsx
 * @description Agent 详情全屏页面，展示 Agent 的头像、模型配置、系统提示词、
 *              绑定的 MCP 服务器和技能列表。卡片式布局对齐 demo 设计。
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RouteParamList } from '../types/RouteTypes.ts';
import type { LucideIcon } from 'lucide-react-native';
import {
  Brain,
  Hash,
  Gauge,
  Moon,
  Languages,
  MessageSquare,
  FolderOpen,
  Plug,
  Sparkles,
  ChevronRight,
  Calendar,
  Clock,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, ColorScheme } from '../theme/index.ts';
import { logger } from '../lib/logger';
import {
  type AgentInfo,
  type McpServerInfo,
  type SkillInfo,
  fetchAgentDetail,
  fetchMcpServers,
  fetchSkills,
} from '../api/server-api.ts';
import { getServerAddress } from '../storage/StorageUtils.ts';
import AgentAvatar from '../chat/component/AgentAvatar.tsx';

type Props = NativeStackScreenProps<RouteParamList, 'AgentDetail'>;

/** 根据 MCP 状态返回对应圆点颜色 */
function getMcpStatusColor(
  status: McpServerInfo['status'],
  error?: string,
  colors?: ColorScheme
): string {
  if (error) {
    return colors?.error ?? '#ff4444';
  }
  if (status === 'connected') {
    return colors?.success ?? '#00C851';
  }
  if (status === 'needs_auth') {
    return '#FF9800';
  }
  return colors?.textTertiary ?? '#999999';
}

/** 图标 + 标签 + 右侧值的通用行 */
function InfoRow({
  icon: Icon,
  label,
  value,
  colors,
  styles,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  colors: ColorScheme;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.row}>
      <Icon size={16} color={colors.text} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

/**
 * Agent 详情全屏页面。
 * 进入时并行请求 Agent 详情、MCP 列表、Skills 列表，
 * 然后根据 Agent 绑定的 mcpNames / skillNames 过滤展示。
 */
const AgentDetailScreen: React.FC<Props> = ({ route }) => {
  const { agentId } = route.params;
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const styles = createStyles(colors);

  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [mcps, setMcps] = useState<McpServerInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [promptExpanded, setPromptExpanded] = useState(false);

  useEffect(() => {
    const load = async () => {
      const address = getServerAddress();
      if (!address) {
        return;
      }
      try {
        const [agentData, allMcps, allSkills] = await Promise.all([
          fetchAgentDetail(address, agentId),
          fetchMcpServers(address),
          fetchSkills(address),
        ]);
        setAgent(agentData);

        // 按 Agent 绑定的名称过滤，只展示该 Agent 实际使用的 MCP 和 Skill
        const nameSet = new Set(agentData.mcpNames);
        setMcps(allMcps.filter((m) => nameSet.has(m.name)));

        const skillSet = new Set(agentData.skillNames);
        setSkills(allSkills.filter((s) => skillSet.has(s.name)));
      } catch (e) {
        logger.error(`[AgentDetail] load failed: ${e}`);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [agentId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!agent) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>{t('agent.notFound')}</Text>
      </View>
    );
  }

  const displayName = agent.name || t('agent.defaultName');
  const modelDisplay = `${agent.defaultModel.provider} / ${agent.defaultModel.model}`;
  const serverAddr = getServerAddress();

  const rowProps = { colors, styles };

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.content}
    >
      {/* 头像 + 名称 + 描述 */}
      <View style={styles.avatarCard}>
        <AgentAvatar
          agentId={agentId}
          serverAddress={serverAddr}
          size={64}
          fallbackIconSize={32}
          fallbackBackgroundColor={colors.surfaceSecondary}
        />
        <Text style={styles.name}>{displayName}</Text>
        {agent.description ? (
          <Text style={styles.description}>{agent.description}</Text>
        ) : null}
      </View>

      {/* 基础设置 */}
      <Text style={styles.sectionLabel}>{t('agent.baseSettings')}</Text>
      <View style={styles.card}>
        <InfoRow
          {...rowProps}
          icon={Brain}
          label={t('agent.defaultModel')}
          value={modelDisplay}
        />
        <View style={styles.divider} />
        <InfoRow
          {...rowProps}
          icon={Hash}
          label={t('agent.maxSteps')}
          value={String(agent.maxSteps)}
        />
        <View style={styles.divider} />
        <InfoRow
          {...rowProps}
          icon={Gauge}
          label={t('agent.compressionThreshold')}
          value={`${agent.compressionThreshold}%`}
        />
        <View style={styles.divider} />
        <InfoRow
          {...rowProps}
          icon={Moon}
          label={t('agent.memoryInterval')}
          value={t('agent.minutes', { count: agent.dreamIntervalMinutes })}
        />
        {agent.voiceLanguage ? (
          <>
            <View style={styles.divider} />
            <InfoRow
              {...rowProps}
              icon={Languages}
              label={t('agent.voiceLanguage')}
              value={agent.voiceLanguage}
            />
          </>
        ) : null}
        <View style={styles.divider} />

        {/* 系统提示词（可折叠） */}
        <TouchableOpacity
          style={styles.row}
          onPress={() => setPromptExpanded((v) => !v)}
          activeOpacity={0.7}
        >
          <MessageSquare size={16} color={colors.text} />
          <Text style={styles.rowLabel}>{t('agent.systemPrompt')}</Text>
          <ChevronRight
            size={16}
            color={colors.textTertiary}
            style={[styles.chevron, promptExpanded && styles.chevronExpanded]}
          />
        </TouchableOpacity>
        {promptExpanded && agent.systemPrompt ? (
          <View style={styles.promptContainer}>
            <Text style={styles.promptText}>{agent.systemPrompt}</Text>
          </View>
        ) : null}

        {agent.defaultWorkspacePath ? (
          <>
            <View style={styles.divider} />
            <View style={styles.row}>
              <FolderOpen size={16} color={colors.text} />
              <View style={styles.workspaceContent}>
                <Text style={styles.rowLabel}>{t('agent.workspacePath')}</Text>
                <Text style={styles.workspacePath} numberOfLines={1}>
                  {agent.defaultWorkspacePath}
                </Text>
              </View>
            </View>
          </>
        ) : null}

        <View style={styles.divider} />
        <InfoRow
          {...rowProps}
          icon={Calendar}
          label={t('agent.createdAt')}
          value={new Date(agent.createdAt).toLocaleDateString(
            i18n.language === 'zh' ? 'zh-CN' : 'en-US'
          )}
        />
        <View style={styles.divider} />
        <InfoRow
          {...rowProps}
          icon={Clock}
          label={t('agent.updatedAt')}
          value={new Date(agent.updatedAt).toLocaleDateString(
            i18n.language === 'zh' ? 'zh-CN' : 'en-US'
          )}
        />
      </View>

      {/* MCP 服务 */}
      {mcps.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>{t('agent.mcpServices')}</Text>
          <View style={styles.card}>
            {mcps.map((mcp, i) => {
              const needsAuth = mcp.status === 'needs_auth';
              const handleAuth = () => {
                if (mcp.oauthUrl) {
                  Linking.openURL(mcp.oauthUrl).catch((e: unknown) =>
                    logger.error(`[AgentDetail] open oauthUrl failed: ${e}`)
                  );
                }
              };
              return (
                <React.Fragment key={mcp.name}>
                  <TouchableOpacity
                    style={styles.row}
                    disabled={!(needsAuth && mcp.oauthUrl)}
                    onPress={handleAuth}
                    activeOpacity={0.7}
                  >
                    <Plug size={16} color={colors.text} />
                    <Text style={styles.rowLabel}>{mcp.name}</Text>
                    <View
                      style={[
                        styles.statusDot,
                        {
                          backgroundColor: getMcpStatusColor(
                            mcp.status,
                            mcp.error,
                            colors
                          ),
                        },
                      ]}
                    />
                    <Text style={styles.mcpToolCount}>
                      {needsAuth
                        ? mcp.oauthUrl
                          ? t('agent.needsAuthArrow')
                          : t('agent.needsAuth')
                        : t('agent.toolCount', { count: mcp.toolCount })}
                    </Text>
                  </TouchableOpacity>
                  {i < mcps.length - 1 ? <View style={styles.divider} /> : null}
                </React.Fragment>
              );
            })}
          </View>
        </>
      )}

      {/* 技能 */}
      {skills.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>{t('agent.skills')}</Text>
          <View style={styles.card}>
            {skills.map((skill, i) => (
              <React.Fragment key={skill.name}>
                <View style={styles.skillRow}>
                  <Sparkles size={16} color={colors.text} />
                  <View style={styles.skillContent}>
                    <Text style={styles.rowLabel}>{skill.name}</Text>
                    {skill.description ? (
                      <Text style={styles.skillDesc} numberOfLines={2}>
                        {skill.description}
                      </Text>
                    ) : null}
                  </View>
                </View>
                {i < skills.length - 1 ? <View style={styles.divider} /> : null}
              </React.Fragment>
            ))}
          </View>
        </>
      )}

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
};

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    scrollView: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    content: {
      padding: 16,
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.surface,
    },
    emptyText: {
      fontSize: 16,
      color: colors.textSecondary,
    },
    avatarCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 20,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.borderLight,
    },
    avatar: {
      width: 64,
      height: 64,
      borderRadius: 32,
      overflow: 'hidden',
    },
    avatarFallback: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.surfaceSecondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    name: {
      fontSize: 18,
      fontWeight: '500',
      color: colors.text,
      marginTop: 12,
    },
    description: {
      fontSize: 13,
      color: colors.textTertiary,
      marginTop: 6,
      textAlign: 'center',
      lineHeight: 18,
    },
    sectionLabel: {
      fontSize: 13,
      color: colors.textSecondary,
      marginLeft: 16,
      marginBottom: 8,
      marginTop: 20,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.borderLight,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    rowLabel: {
      fontSize: 15,
      color: colors.text,
      flex: 1,
    },
    rowValue: {
      fontSize: 15,
      color: colors.textSecondary,
    },
    chevron: {
      marginLeft: 'auto',
    },
    chevronExpanded: {
      transform: [{ rotate: '90deg' }],
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.borderLight,
      marginHorizontal: 16,
    },
    promptContainer: {
      paddingHorizontal: 16,
      paddingBottom: 14,
    },
    promptText: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 12,
    },
    workspaceContent: {
      flex: 1,
    },
    workspacePath: {
      fontSize: 13,
      color: colors.textTertiary,
      marginTop: 2,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    mcpToolCount: {
      fontSize: 13,
      color: colors.textTertiary,
      marginLeft: 8,
    },
    skillRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    skillContent: {
      flex: 1,
    },
    skillDesc: {
      fontSize: 13,
      color: colors.textTertiary,
      marginTop: 2,
    },
    bottomSpacer: {
      height: 20,
    },
  });

export default AgentDetailScreen;
