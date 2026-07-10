/**
 * @file AgentDetailScreen.tsx
 * @description Agent 详情全屏页面，展示 Agent 的头像、模型配置、系统提示词、
 *              绑定的 MCP 服务器和技能列表。
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RouteParamList } from '../types/RouteTypes.ts';
import { User } from 'lucide-react-native';
import { useTheme, ColorScheme } from '../theme/index.ts';
import { logger } from '../lib/logger';
import {
  type AgentInfo,
  type McpServerInfo,
  type SkillInfo,
  fetchAgentDetail,
  fetchMcpServers,
  fetchSkills,
  getAgentAvatarUrl,
} from '../api/server-api.ts';
import { getServerAddress } from '../storage/StorageUtils.ts';

type Props = NativeStackScreenProps<RouteParamList, 'AgentDetail'>;

/** 根据 MCP 状态返回对应圆点颜色 */
function getMcpStatusColor(
  status: McpServerInfo['status'],
  error?: string,
  colors?: ColorScheme
): string {
  if (error) return colors?.error ?? '#ff4444';
  if (status === 'connected') return colors?.success ?? '#00C851';
  if (status === 'needs_auth') return '#FF9800';
  return colors?.textTertiary ?? '#999999';
}

/**
 * Agent 详情全屏页面。
 * 进入时并行请求 Agent 详情、MCP 列表、Skills 列表，
 * 然后根据 Agent 绑定的 mcpNames / skillNames 过滤展示。
 */
const AgentDetailScreen: React.FC<Props> = ({ route }) => {
  const { agentId } = route.params;
  const { colors } = useTheme();
  const styles = createStyles(colors);

  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [mcps, setMcps] = useState<McpServerInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  useEffect(() => {
    const load = async () => {
      const address = getServerAddress();
      if (!address) return;
      try {
        const [agentData, allMcps, allSkills] = await Promise.all([
          fetchAgentDetail(address, agentId),
          fetchMcpServers(address),
          fetchSkills(address),
        ]);
        setAgent(agentData);
        setAvatarError(false);

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
        <Text style={styles.emptyText}>Agent not found</Text>
      </View>
    );
  }

  const displayName = agent.name || 'Agent';

  const modelDisplay = `${agent.defaultModel.provider} / ${agent.defaultModel.model}`;

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.content}
    >
      {/* 头像 + 名称 + 描述：具备加载条件时请求服务器 URL，否则显示灰色占位符 */}
      <View style={styles.avatarCard}>
        {(() => {
          const serverAddr = getServerAddress();
          const canLoad = serverAddr.length > 0 && agentId.length > 0;
          return canLoad && !avatarError ? (
            <Image
              source={{ uri: getAgentAvatarUrl(agentId, serverAddr) }}
              style={styles.avatar}
              onError={() => setAvatarError(true)}
            />
          ) : (
            <View style={[styles.avatar, { backgroundColor: '#E5E7EB' }]}>
              <User size={32} color="#9CA3AF" />
            </View>
          );
        })()}
        <Text style={styles.name}>{displayName}</Text>
        {agent.description ? (
          <Text style={styles.description}>{agent.description}</Text>
        ) : null}
      </View>

      {/* 基础设置 */}
      <Text style={styles.sectionLabel}>基础设置</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>默认模型</Text>
          <Text style={styles.rowValue}>{modelDisplay}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>最大步数</Text>
          <Text style={styles.rowValue}>{agent.maxSteps}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>压缩阈值</Text>
          <Text style={styles.rowValue}>{agent.compressionThreshold}%</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>记忆间隔</Text>
          <Text style={styles.rowValue}>{agent.dreamIntervalMinutes} 分钟</Text>
        </View>
        {agent.voiceLanguage ? (
          <>
            <View style={styles.divider} />
            <View style={styles.row}>
              <Text style={styles.rowLabel}>语音语言</Text>
              <Text style={styles.rowValue}>{agent.voiceLanguage}</Text>
            </View>
          </>
        ) : null}
        <View style={styles.divider} />

        {/* 系统提示词（可折叠） */}
        <TouchableOpacity
          style={styles.row}
          onPress={() => setPromptExpanded((v) => !v)}
          activeOpacity={0.7}
        >
          <Text style={styles.rowLabel}>系统提示词</Text>
          <Text style={styles.chevron}>{promptExpanded ? '▼' : '▶'}</Text>
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
              <Text style={styles.rowLabel}>工作区路径</Text>
            </View>
            <View style={styles.promptContainer}>
              <Text style={styles.promptText}>
                {agent.defaultWorkspacePath}
              </Text>
            </View>
          </>
        ) : null}
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>创建时间</Text>
          <Text style={styles.rowValue}>
            {new Date(agent.createdAt).toLocaleDateString('zh-CN')}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>更新时间</Text>
          <Text style={styles.rowValue}>
            {new Date(agent.updatedAt).toLocaleDateString('zh-CN')}
          </Text>
        </View>
      </View>

      {/* MCP 服务 */}
      {mcps.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>MCP 服务</Text>
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
                    <Text style={styles.rowLabelMcp}>{mcp.name}</Text>
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
                          ? '需要授权 →'
                          : '需要授权'
                        : `${mcp.toolCount} 个工具`}
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
          <Text style={styles.sectionLabel}>技能</Text>
          <View style={styles.card}>
            {skills.map((skill, i) => (
              <React.Fragment key={skill.name}>
                <View style={styles.skillRow}>
                  <Text style={styles.rowLabelMcp}>{skill.name}</Text>
                  {skill.description ? (
                    <Text style={styles.skillDesc}>{skill.description}</Text>
                  ) : null}
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
      backgroundColor: colors.background,
    },
    content: {
      padding: 16,
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
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
    },
    avatar: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
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
      color: colors.textTertiary,
      marginLeft: 16,
      marginBottom: 8,
      marginTop: 20,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    rowLabel: {
      fontSize: 15,
      color: colors.text,
    },
    rowLabelMcp: {
      fontSize: 15,
      color: colors.text,
      flex: 1,
    },
    rowValue: {
      fontSize: 15,
      color: colors.textSecondary,
      marginLeft: 'auto',
    },
    chevron: {
      fontSize: 10,
      color: colors.textTertiary,
      marginLeft: 'auto',
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
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginLeft: 8,
    },
    mcpToolCount: {
      fontSize: 13,
      color: colors.textTertiary,
      marginLeft: 8,
    },
    skillRow: {
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    skillDesc: {
      fontSize: 13,
      color: colors.textTertiary,
      marginTop: 4,
    },
    bottomSpacer: {
      height: 20,
    },
  });

export default AgentDetailScreen;
