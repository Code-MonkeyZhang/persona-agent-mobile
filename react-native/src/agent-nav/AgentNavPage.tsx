/**
 * @file AgentNavPage.tsx
 * @description 工具与技能的管理页，单页双视图由入口行携带的 view 参数决定。
 *   数据取当前 agent 的 mcpNames 与 skillNames，工具与技能视图都分已分配与库两组，
 *   内置三项常驻已分配组，不可移除也不参与写回，
 *   AssignButton 是分配的唯一入口，本地先切换分组，写回失败回滚并提示。
 *   长相基准是 demo 的 AgentNavPage，行为基准是桌面端。
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppWindow,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, ColorScheme, typography } from '../theme/index.ts';
import { RouteParamList } from '../types/RouteTypes.ts';
import {
  type AgentInfo,
  type McpServerInfo,
  type SkillInfo,
  fetchAgentDetail,
  fetchMcpServers,
  fetchSkills,
  updateAgent,
} from '../api/server-api.ts';
import { getServerAddress, getServerAgentId } from '../storage/StorageUtils.ts';
import { logger } from '../lib/logger';
import { BUILT_IN_TOOLS, type BuiltInTool } from './builtInTools.ts';
import {
  AssignButton,
  EntityLogo,
  GroupBlock,
  mcpStatusMeta,
  StatusBadge,
} from './component/NavDetailShared.tsx';

type Props = NativeStackScreenProps<RouteParamList, 'AgentNav'>;

/** 空态：图标加文案居中，整库为空时顶替分组渲染 */
function EmptyState({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.emptyState}>
      <Icon size={40} color={colors.textTertiary} />
      <Text style={styles.emptyStateText}>{text}</Text>
    </View>
  );
}

/** 工具行：logo 磁贴加状态点与显示名，副行是连接状态，行尾加减号 */
function ToolRow({
  server,
  assigned,
  first,
  onOpen,
  onToggleAssign,
}: {
  server: McpServerInfo;
  assigned: boolean;
  first?: boolean;
  onOpen: () => void;
  onToggleAssign: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const meta = mcpStatusMeta(server, colors);
  return (
    <TouchableOpacity
      style={[styles.row, !first && styles.rowBorder]}
      activeOpacity={0.7}
      onPress={onOpen}
    >
      <EntityLogo
        src={server.logoUrl}
        fallback={server.agentApp ? AppWindow : Wrench}
        size="sm"
      />
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {server.displayName ?? server.name}
        </Text>
        <View style={styles.subLine}>
          <StatusBadge color={meta.color} label={t(meta.labelKey)} />
        </View>
      </View>
      <AssignButton assigned={assigned} onPress={onToggleAssign} />
    </TouchableOpacity>
  );
}

/** 内置工具行：图标加名称，副行是常绿状态标，常驻已分配组，不带加减号 */
function BuiltinToolRow({
  tool,
  first,
  onOpen,
}: {
  tool: BuiltInTool;
  first?: boolean;
  onOpen: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  return (
    <TouchableOpacity
      style={[styles.row, !first && styles.rowBorder]}
      activeOpacity={0.7}
      onPress={onOpen}
    >
      <View style={styles.builtinIconBox}>
        <tool.icon size={16} color={colors.primary} />
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {tool.name}
        </Text>
        <View style={styles.subLine}>
          <StatusBadge
            color={colors.success}
            label={t('detail.statusConnected')}
          />
        </View>
      </View>
    </TouchableOpacity>
  );
}

/** 技能行：名称加描述两行，行尾加减号 */
function SkillRow({
  skill,
  assigned,
  first,
  onOpen,
  onToggleAssign,
}: {
  skill: SkillInfo;
  assigned: boolean;
  first?: boolean;
  onOpen: () => void;
  onToggleAssign: () => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <TouchableOpacity
      style={[styles.skillRow, !first && styles.rowBorder]}
      activeOpacity={0.7}
      onPress={onOpen}
    >
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {skill.displayName ?? skill.name}
        </Text>
        <Text style={styles.skillRowSub} numberOfLines={1}>
          {skill.description}
        </Text>
      </View>
      <AssignButton assigned={assigned} onPress={onToggleAssign} />
    </TouchableOpacity>
  );
}

/** 按绑定名称表从清单里挑出已分配条目，保持 mcpNames 的既有顺序 */
function pickAssigned<T extends { name: string }>(
  names: string[],
  entries: T[]
): T[] {
  return names
    .map((n) => entries.find((e) => e.name === n))
    .filter((e): e is T => Boolean(e));
}

const AgentNavPage: React.FC<Props> = ({ route, navigation }) => {
  const { view } = route.params;
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);

  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  /** 进页并行拉当前 agent 详情与工具技能两份清单，按名称对齐分配态 */
  const load = useCallback(async () => {
    const address = getServerAddress();
    const agentId = getServerAgentId();
    if (!address || !agentId) {
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    try {
      const [agentData, allServers, allSkills] = await Promise.all([
        fetchAgentDetail(address, agentId),
        fetchMcpServers(address),
        fetchSkills(address),
      ]);
      setAgent(agentData);
      setServers(allServers);
      setSkills(allSkills);
      setLoadFailed(false);
      logger.info(
        `[AgentNav] loaded, servers=${allServers.length} skills=${allSkills.length}` +
          ` mcpAssigned=${agentData.mcpNames.length} skillAssigned=${agentData.skillNames.length}`
      );
    } catch (e) {
      logger.error(`[AgentNav] load failed: ${e}`);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    logger.info(`[AgentNav] mounted, view=${view}`);
    load();
  }, [load, view]);

  /** 把目标名称数组合回本地 agent 状态，只动对应的一组字段 */
  const applyNames = (kind: 'mcp' | 'skill', names: string[]) => {
    setAgent((cur) => {
      if (!cur) {
        return cur;
      }
      return kind === 'mcp'
        ? { ...cur, mcpNames: names }
        : { ...cur, skillNames: names };
    });
  };

  /**
   * 切换分配态。本地先切换分组，再走 updateAgent 写回全量名称数组，
   * 失败时回滚本地分组并弹窗提示，成功时本地已是目标态无需覆盖。
   * @param kind 名称数组归属，mcp 写回 mcpNames，skill 写回 skillNames
   * @param name 条目机器名
   */
  const toggleAssign = (kind: 'mcp' | 'skill', name: string) => {
    if (!agent) {
      return;
    }
    const prev = kind === 'mcp' ? agent.mcpNames : agent.skillNames;
    const next = prev.includes(name)
      ? prev.filter((n) => n !== name)
      : [...prev, name];
    applyNames(kind, next);
    const address = getServerAddress();
    if (!address) {
      return;
    }
    const target = next.includes(name) ? 'assigned' : 'unassigned';
    logger.info(`[AgentNav] toggle ${kind} assign: ${name} → ${target}`);
    updateAgent(
      address,
      agent.id,
      kind === 'mcp' ? { mcpNames: next } : { skillNames: next }
    ).catch((e) => {
      logger.warn(`[AgentNav] assign write failed, rollback: ${name} ${e}`);
      applyNames(kind, prev);
      Alert.alert(t('nav.assignFailedTitle'), t('nav.assignFailedMsg'));
    });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (loadFailed || !agent) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyStateText}>{t('nav.loadFailed')}</Text>
      </View>
    );
  }

  const toolsView = () => {
    if (servers.length === 0) {
      return <EmptyState icon={Wrench} text={t('nav.emptyTools')} />;
    }
    const assigned = pickAssigned(agent.mcpNames, servers);
    const pool = servers.filter((s) => !agent.mcpNames.includes(s.name));
    return (
      <>
        <GroupBlock
          label={t('nav.groupAssignedTools')}
          count={BUILT_IN_TOOLS.length + assigned.length}
          emptyHint={t('nav.emptyAssignedTools')}
        >
          {BUILT_IN_TOOLS.map((tool, i) => (
            <BuiltinToolRow
              key={tool.id}
              tool={tool}
              first={i === 0}
              onOpen={() =>
                navigation.navigate('BuiltinDetail', { id: tool.id })
              }
            />
          ))}
          {assigned.map((server) => (
            <ToolRow
              key={server.name}
              server={server}
              assigned
              onOpen={() =>
                navigation.navigate('McpDetail', { name: server.name })
              }
              onToggleAssign={() => toggleAssign('mcp', server.name)}
            />
          ))}
        </GroupBlock>
        <GroupBlock
          label={t('nav.groupToolPool')}
          count={pool.length}
          emptyHint={t('nav.allToolsAssigned')}
        >
          {pool.map((server, i) => (
            <ToolRow
              key={server.name}
              server={server}
              assigned={false}
              first={i === 0}
              onOpen={() =>
                navigation.navigate('McpDetail', { name: server.name })
              }
              onToggleAssign={() => toggleAssign('mcp', server.name)}
            />
          ))}
        </GroupBlock>
      </>
    );
  };

  const skillsView = () => {
    if (skills.length === 0) {
      return <EmptyState icon={Sparkles} text={t('nav.emptySkills')} />;
    }
    const assigned = pickAssigned(agent.skillNames, skills);
    const pool = skills.filter((s) => !agent.skillNames.includes(s.name));
    return (
      <>
        <GroupBlock
          label={t('nav.groupAssigned')}
          count={assigned.length}
          emptyHint={t('nav.emptyAssignedSkills')}
        >
          {assigned.map((skill, i) => (
            <SkillRow
              key={skill.name}
              skill={skill}
              assigned
              first={i === 0}
              onOpen={() =>
                navigation.navigate('SkillDetail', { name: skill.name })
              }
              onToggleAssign={() => toggleAssign('skill', skill.name)}
            />
          ))}
        </GroupBlock>
        <GroupBlock
          label={t('nav.groupSkillPool')}
          count={pool.length}
          emptyHint={t('nav.allSkillsAssigned')}
        >
          {pool.map((skill, i) => (
            <SkillRow
              key={skill.name}
              skill={skill}
              assigned={false}
              first={i === 0}
              onOpen={() =>
                navigation.navigate('SkillDetail', { name: skill.name })
              }
              onToggleAssign={() => toggleAssign('skill', skill.name)}
            />
          ))}
        </GroupBlock>
      </>
    );
  };

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}
    >
      {view === 'tools' ? toolsView() : skillsView()}
    </ScrollView>
  );
};

/** 管理页样式工厂 */
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
    scrollContent: {
      padding: 16,
      paddingBottom: 40,
    },
    emptyState: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 80,
    },
    emptyStateText: {
      ...typography.body,
      color: colors.textTertiary,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    skillRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    rowBorder: {
      borderTopWidth: 1,
      borderTopColor: colors.borderLight,
    },
    rowContent: {
      flex: 1,
      minWidth: 0,
    },
    rowTitle: {
      ...typography.body,
      color: colors.text,
    },
    /** 副行容器，收住状态标与标题行的间距 */
    subLine: {
      marginTop: 2,
    },
    skillRowSub: {
      marginTop: 2,
      ...typography.meta,
      color: colors.textTertiary,
    },
    builtinIconBox: {
      width: 32,
      height: 32,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySelectedBackground,
      flexShrink: 0,
    },
  });

export default AgentNavPage;
