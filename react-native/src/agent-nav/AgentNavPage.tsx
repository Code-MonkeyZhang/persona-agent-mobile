/**
 * @file AgentNavPage.tsx
 * @description 工具与技能的管理页，单页双视图由入口行携带的 view 参数决定。
 *   headerTitle 按视图配图标加文字的组合，图标与首页入口行同源。
 *   工具视图读注册表清单分三组，内置组独立置顶，行尾开关写分配端点，
 *   已分配与未分配两组住 mcp 与 app 条目，加减号同写分配端点，
 *   assigned 直读服务端标记，客户端不派生默认值。
 *   技能视图取 agent 的 skillNames 与 /api/skills 清单分两组，行为不变。
 *   进页数据态由 PageLoadState 整页呈现，工具看 store 缓存与错误，技能看本页拉数状态。
 *   长相基准是 demo 的 AgentNavPage，行为基准是桌面端。
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
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
  type SkillInfo,
  type ToolEntryInfo,
  fetchAgentDetail,
  fetchSkills,
  updateAgent,
} from '../api/server-api.ts';
import { getServerAddress, getServerAgentId } from '../storage/StorageUtils.ts';
import { IconHeaderTitle } from '../component/IconHeaderTitle.tsx';
import { PageLoadState, type PagePhase } from '../component/PageLoadState.tsx';
import { useToolsStore } from '../stores/toolsStore.ts';
import { logger } from '../lib/logger';
import { BUILTIN_ICONS, BUILTIN_ICON_FALLBACK } from './builtInTools.ts';
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

/**
 * 内置工具行：图标加名称，副行开时显示功能数关时显示已关闭，
 * 行尾开关写分配端点，写径在途时锁定防重复点击，关掉的行置灰但留在组内。
 */
function BuiltinToolRow({
  entry,
  disabled,
  locked,
  first,
  onOpen,
  onToggle,
}: {
  entry: ToolEntryInfo;
  disabled: boolean;
  /** 写分配在途，开关暂锁 */
  locked: boolean;
  first?: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const Icon = BUILTIN_ICONS[entry.id] ?? BUILTIN_ICON_FALLBACK;
  return (
    <TouchableOpacity
      style={[
        styles.row,
        !first && styles.rowBorder,
        disabled && styles.rowDimmed,
      ]}
      activeOpacity={0.7}
      onPress={onOpen}
    >
      <View style={styles.builtinIconBox}>
        <Icon size={16} color={colors.primary} />
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {entry.name}
        </Text>
        <View style={styles.subLine}>
          <StatusBadge
            color={disabled ? colors.textTertiary : colors.success}
            label={
              disabled
                ? t('nav.builtinOff')
                : t('nav.funcCount', { count: entry.functions.length })
            }
          />
        </View>
      </View>
      <Switch
        value={!disabled}
        onValueChange={onToggle}
        disabled={locked}
        trackColor={{ false: colors.border, true: colors.primary }}
      />
    </TouchableOpacity>
  );
}

/** 外部工具行：logo 磁贴加显示名，副行四态状态标，行尾加减号写分配端点 */
function ToolRow({
  entry,
  assigned,
  first,
  onOpen,
  onToggleAssign,
}: {
  entry: ToolEntryInfo;
  assigned: boolean;
  first?: boolean;
  onOpen: () => void;
  onToggleAssign: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const meta = mcpStatusMeta(entry.status, colors);
  return (
    <TouchableOpacity
      style={[styles.row, !first && styles.rowBorder]}
      activeOpacity={0.7}
      onPress={onOpen}
    >
      <EntityLogo
        src={entry.logoUrl}
        fallback={entry.kind === 'app' ? AppWindow : Wrench}
        size="sm"
      />
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {entry.name}
        </Text>
        <View style={styles.subLine}>
          <StatusBadge color={meta.color} label={t(meta.labelKey)} />
        </View>
      </View>
      <AssignButton assigned={assigned} onPress={onToggleAssign} />
    </TouchableOpacity>
  );
}

/** 技能行：卡片图标加名称描述两行，图标缺失兜底技能图标，行尾加减号 */
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
      <EntityLogo src={skill.logoUrl} fallback={Sparkles} size="sm" />
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

const AgentNavPage: React.FC<Props> = ({ route, navigation }) => {
  const { view } = route.params;
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);

  const toolsEntries = useToolsStore((s) => s.entries);
  const toolsError = useToolsStore((s) => s.entriesError);
  const loadTools = useToolsStore((s) => s.loadTools);
  const toggleAssignment = useToolsStore((s) => s.toggleAssignment);
  const assigning = useToolsStore((s) => s.assigning);

  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  /** headerTitle 按视图配图标，工具扳手技能闪光，与首页入口行同源 */
  useEffect(() => {
    navigation.setOptions({
      // eslint-disable-next-line react/no-unstable-nested-components
      headerTitle: () =>
        view === 'tools' ? (
          <IconHeaderTitle icon={Wrench} title={t('nav.titleTools')} />
        ) : (
          <IconHeaderTitle icon={Sparkles} title={t('nav.titleSkills')} />
        ),
    });
  }, [navigation, view, t]);

  /** 进页按视图拉数，工具视图走 store 拉注册表，技能视图并行拉 agent 与技能清单 */
  useEffect(() => {
    logger.info(`[AgentNav] mounted, view=${view}`);
    if (view === 'tools') {
      loadTools(getServerAgentId() || undefined);
      return;
    }
    const address = getServerAddress();
    const agentId = getServerAgentId();
    if (!address || !agentId) {
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    Promise.all([fetchAgentDetail(address, agentId), fetchSkills(address)])
      .then(([agentData, allSkills]) => {
        setAgent(agentData);
        setSkills(allSkills);
        setLoadFailed(false);
        logger.info(
          `[AgentNav] loaded, skills=${allSkills.length}` +
            ` skillAssigned=${agentData.skillNames.length}`
        );
      })
      .catch((e) => {
        logger.error(`[AgentNav] load failed: ${e}`);
        setLoadFailed(true);
      })
      .finally(() => setLoading(false));
  }, [loadTools, view]);

  /**
   * 切换技能分配态。本地先切换分组，再走 updateAgent 写回全量名称数组，
   * 失败时回滚本地分组并弹窗提示，成功时本地已是目标态无需覆盖。
   * @param skill 技能条目
   */
  const toggleSkillAssign = (skill: SkillInfo) => {
    if (!agent) {
      return;
    }
    const prev = agent.skillNames;
    const next = prev.includes(skill.name)
      ? prev.filter((n) => n !== skill.name)
      : [...prev, skill.name];
    setAgent({ ...agent, skillNames: next });
    const address = getServerAddress();
    if (!address) {
      return;
    }
    const target = next.includes(skill.name) ? 'assigned' : 'unassigned';
    logger.info(`[AgentNav] toggle skill assign: ${skill.name} → ${target}`);
    updateAgent(address, agent.id, { skillNames: next }).catch((e) => {
      logger.warn(
        `[AgentNav] skill assign write failed, rollback: ${skill.name} ${e}`
      );
      setAgent((cur) => (cur ? { ...cur, skillNames: prev } : cur));
      Alert.alert(t('nav.assignFailedTitle'), t('nav.assignFailedMsg'));
    });
  };

  const openToolDetail = (entry: ToolEntryInfo) => {
    if (entry.kind === 'builtin') {
      navigation.navigate('BuiltinDetail', { id: entry.id });
    } else {
      navigation.navigate('McpDetail', { id: entry.id });
    }
  };

  const toolsView = () => {
    if (!toolsEntries) return null;
    if (toolsEntries.length === 0) {
      return <EmptyState icon={Wrench} text={t('nav.emptyTools')} />;
    }
    const builtin = toolsEntries.filter((e) => e.kind === 'builtin');
    const external = toolsEntries.filter((e) => e.kind !== 'builtin');
    const assigned = external.filter((e) => e.assigned === true);
    const pool = external.filter((e) => e.assigned !== true);
    return (
      <>
        <GroupBlock
          label={t('nav.groupBuiltin')}
          count={builtin.length}
          emptyHint={t('nav.emptyTools')}
        >
          {builtin.map((entry, i) => (
            <BuiltinToolRow
              key={entry.id}
              entry={entry}
              disabled={entry.assigned === false}
              locked={assigning.has(entry.id)}
              first={i === 0}
              onOpen={() => openToolDetail(entry)}
              onToggle={() => toggleAssignment(entry.id)}
            />
          ))}
        </GroupBlock>
        <GroupBlock
          label={t('nav.groupAssignedTools')}
          count={assigned.length}
          emptyHint={t('nav.emptyAssignedTools')}
        >
          {assigned.map((entry, i) => (
            <ToolRow
              key={entry.id}
              entry={entry}
              assigned
              first={i === 0}
              onOpen={() => openToolDetail(entry)}
              onToggleAssign={() => toggleAssignment(entry.id)}
            />
          ))}
        </GroupBlock>
        <GroupBlock
          label={t('nav.groupToolPool')}
          count={pool.length}
          emptyHint={t('nav.allToolsAssigned')}
        >
          {pool.map((entry, i) => (
            <ToolRow
              key={entry.id}
              entry={entry}
              assigned={false}
              first={i === 0}
              onOpen={() => openToolDetail(entry)}
              onToggleAssign={() => toggleAssignment(entry.id)}
            />
          ))}
        </GroupBlock>
      </>
    );
  };

  const skillsView = () => {
    if (!agent) {
      return null;
    }
    if (skills.length === 0) {
      return <EmptyState icon={Sparkles} text={t('nav.emptySkills')} />;
    }
    const assignedNames = agent.skillNames;
    const assigned = skills.filter((s) => assignedNames.includes(s.name));
    const pool = skills.filter((s) => !assignedNames.includes(s.name));
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
              onToggleAssign={() => toggleSkillAssign(skill)}
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
              onToggleAssign={() => toggleSkillAssign(skill)}
            />
          ))}
        </GroupBlock>
      </>
    );
  };

  /** 工具视图数据态：store 有缓存即就绪，首拉在途转圈，首拉失败整页失败态 */
  const toolsPhase: PagePhase = toolsEntries
    ? 'ready'
    : toolsError
    ? 'error'
    : 'loading';
  /** 技能视图数据态：拉数在途转圈，失败或无 agent 整页失败态 */
  const skillsPhase: PagePhase = loading
    ? 'loading'
    : loadFailed || !agent
    ? 'error'
    : 'ready';
  const phase = view === 'tools' ? toolsPhase : skillsPhase;

  if (phase !== 'ready') {
    return (
      <View style={styles.scrollView}>
        <PageLoadState phase={phase} />
      </View>
    );
  }

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
    /** 关掉的内置行整行置灰，留在组内不失位 */
    rowDimmed: {
      opacity: 0.5,
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
