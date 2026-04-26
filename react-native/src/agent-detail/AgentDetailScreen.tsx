/**
 * @file AgentDetailScreen.tsx
 * @description Agent 详情全屏页面，展示 Agent 的头像、模型配置、系统提示词、
 *              绑定的 MCP 服务器和技能列表。
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RouteParamList } from '../types/RouteTypes.ts';
import { useTheme, ColorScheme } from '../theme/index.ts';
import {
  type AgentInfo,
  type McpServerInfo,
  type SkillInfo,
  fetchAgentDetail,
  fetchMcpServers,
  fetchSkills,
  getAgentAvatarUrl,
} from '../api/nano-agent-api.ts';
import { getServerAddress } from '../storage/StorageUtils.ts';

type Props = NativeStackScreenProps<RouteParamList, 'AgentDetail'>;

/** 头像背景色预设，与 AgentSelector 保持一致 */
const AVATAR_COLORS = [
  '#4A90D9',
  '#50B86C',
  '#E8913A',
  '#D45B5B',
  '#9B59B6',
  '#1ABC9C',
  '#E67E22',
  '#3498DB',
];

function getAvatarColor(name: string): string {
  const code = name.charCodeAt(0) || 0;
  return AVATAR_COLORS[code % AVATAR_COLORS.length];
}

/** 根据 MCP 状态返回对应圆点颜色 */
function getMcpStatusColor(
  status: McpServerInfo['status'],
  error?: string,
  colors?: ColorScheme
): string {
  if (error) return colors?.error ?? '#ff4444';
  if (status === 'connected') return colors?.success ?? '#00C851';
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
        const nameSet = new Set(agentData.mcpNames ?? []);
        setMcps(allMcps.filter((m) => nameSet.has(m.name)));

        const skillSet = new Set(agentData.skillNames ?? []);
        setSkills(allSkills.filter((s) => skillSet.has(s.name)));
      } catch (e) {
        console.log(`[AgentDetail] load failed: ${e}`);
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
  const initial = displayName.charAt(0).toUpperCase();
  const hasAvatar = !!agent.avatar;

  const defaultModel = agent.defaultModel;
  const modelDisplay = defaultModel
    ? `${defaultModel.provider} / ${defaultModel.model}`
    : '—';

  return (
    <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
      {/* 头像 + 名称 + 描述 */}
      <View style={styles.avatarCard}>
        {hasAvatar && !avatarError ? (
          <Image
            source={{ uri: getAgentAvatarUrl(agentId, getServerAddress() ?? '') }}
            style={styles.avatar}
            onError={() => setAvatarError(true)}
          />
        ) : (
          <View
            style={[styles.avatar, { backgroundColor: getAvatarColor(displayName) }]}
          >
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
        )}
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
          <Text style={styles.rowValue}>{agent.maxSteps ?? '—'}</Text>
        </View>
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
              <Text style={styles.promptText}>{agent.defaultWorkspacePath}</Text>
            </View>
          </>
        ) : null}
      </View>

      {/* MCP 服务 */}
      {mcps.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>MCP 服务</Text>
          <View style={styles.card}>
            {mcps.map((mcp, i) => (
              <React.Fragment key={mcp.name}>
                <View style={styles.row}>
                  <Text style={styles.rowLabelMcp}>{mcp.name}</Text>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: getMcpStatusColor(mcp.status, mcp.error, colors) },
                    ]}
                  />
                  <Text style={styles.mcpToolCount}>
                    {mcp.tools.length} 个工具
                  </Text>
                </View>
                {i < mcps.length - 1 ? <View style={styles.divider} /> : null}
              </React.Fragment>
            ))}
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
    avatarText: {
      color: '#ffffff',
      fontSize: 28,
      fontWeight: '600',
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
