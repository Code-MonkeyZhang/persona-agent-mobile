/**
 * @file MemoryScreen.tsx
 * @description 记忆管理页，从人格详情页与首页入口压栈进入的全屏页。
 *   页面壳由原生 Stack header 承担，新增按钮挂 headerRight 与返回箭头对称。
 *   正文是搜索框、类型筛选与条目行流：行内放标题、类型副行与启停开关，
 *   点行弹底部编辑表单。数据走记忆四接口，进页拉取，增删改后重拉，
 *   与桌面端同款拉模式。启停开关即时落库，停用行半透明，只在全部档出现。
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Plus, Search } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, typography } from '../theme/index.ts';
import { logger } from '../lib/logger';
import type { RouteParamList } from '../types/RouteTypes.ts';
import { GroupCard } from '../agent-nav/component/NavDetailShared.tsx';
import {
  type MemoryEntry,
  createAgentMemory,
  deleteAgentMemory,
  listAgentMemories,
  updateAgentMemory,
} from '../api/server-api.ts';
import { getServerAddress } from '../storage/StorageUtils.ts';
import {
  MemorySheet,
  type MemorySheetDraft,
} from './component/MemorySheet.tsx';

type Props = NativeStackScreenProps<RouteParamList, 'MemoryScreen'>;

/** 类型筛选三档，已停用的条目只在全部档出现 */
type MemoryFilter = 'all' | 'pinned' | 'triggered';

const MemoryScreen: React.FC<Props> = ({ navigation, route }) => {
  const { agentId } = route.params;
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const address = getServerAddress();

  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [filter, setFilter] = useState<MemoryFilter>('all');
  const [search, setSearch] = useState('');
  /** 编辑目标：new 表示新增表单，数字为编辑中的条目编号 */
  const [editing, setEditing] = useState<'new' | number | null>(null);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      setEntries(await listAgentMemories(address, agentId));
    } catch (e) {
      logger.error(`[Memory] list failed: ${e}`);
      Alert.alert(t('memory.loadFailed'));
    }
  }, [address, agentId, t]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  /** headerRight 的新增按钮，与返回箭头对称的裸图标形态 */
  useEffect(() => {
    navigation.setOptions({
      // eslint-disable-next-line react/no-unstable-nested-components
      headerRight: () => (
        <AddButton color={colors.primary} onPress={() => setEditing('new')} />
      ),
    });
  }, [navigation, colors.primary]);

  const editingEntry =
    typeof editing === 'number'
      ? entries.find((e) => e.uid === editing) ?? null
      : null;

  /** 表单保存：新增走 create，编辑走 update，成功后收起并重拉 */
  const handleSubmit = async (draft: MemorySheetDraft) => {
    if (!address) return;
    try {
      if (editing === 'new') {
        await createAgentMemory(address, agentId, draft);
      } else if (typeof editing === 'number') {
        await updateAgentMemory(address, agentId, editing, draft);
      }
      setEditing(null);
      await refresh();
    } catch (e) {
      logger.error(`[Memory] save failed: ${e}`);
      Alert.alert(t('memory.saveFailed'));
    }
  };

  /** 编辑态启停即时落库，失败由表单回滚开关 */
  const handleToggleEnabled = async (uid: number, enabled: boolean) => {
    if (!address) return;
    await updateAgentMemory(address, agentId, uid, { enabled });
    await refresh();
  };

  const handleDelete = async (uid: number) => {
    if (!address) return;
    try {
      await deleteAgentMemory(address, agentId, uid);
      setEditing(null);
      await refresh();
    } catch (e) {
      logger.error(`[Memory] delete failed: ${e}`);
      Alert.alert(t('memory.deleteFailed'));
    }
  };

  /** 行内启停：乐观更新本地行，落库失败回滚并提示 */
  const handleRowToggle = async (entry: MemoryEntry, value: boolean) => {
    if (!address) return;
    setEntries((prev) =>
      prev.map((e) => (e.uid === entry.uid ? { ...e, enabled: value } : e))
    );
    try {
      await updateAgentMemory(address, agentId, entry.uid, { enabled: value });
    } catch (e) {
      logger.error(`[Memory] row toggle failed: ${e}`);
      setEntries((prev) =>
        prev.map((item) =>
          item.uid === entry.uid ? { ...item, enabled: entry.enabled } : item
        )
      );
      Alert.alert(t('memory.saveFailed'));
    }
  };

  const q = search.trim().toLowerCase();
  const filtered = entries.filter((e) => {
    if (filter === 'pinned' && !(e.enabled && e.type === 'pinned'))
      return false;
    if (filter === 'triggered' && !(e.enabled && e.type === 'triggered'))
      return false;
    if (!q) return true;
    return (
      e.title.toLowerCase().includes(q) ||
      e.content.toLowerCase().includes(q) ||
      e.keys.some((k) => k.toLowerCase().includes(q))
    );
  });

  /** 行副行：常驻显固定文案，触发显触发词或空占位 */
  const sublineOf = (entry: MemoryEntry) =>
    entry.type === 'pinned'
      ? t('memory.pinnedSubline')
      : entry.keys.length > 0
      ? entry.keys.join(' · ')
      : t('memory.noKeys');

  const filters: { value: MemoryFilter; label: string }[] = [
    { value: 'all', label: t('memory.filterAll') },
    { value: 'pinned', label: t('memory.filterPinned') },
    { value: 'triggered', label: t('memory.filterTriggered') },
  ];

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.listContent}>
        {/* 搜索框 */}
        <View style={styles.searchBox}>
          <Search size={15} color={colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={t('memory.searchPlaceholder')}
            placeholderTextColor={colors.placeholder}
            returnKeyType="search"
          />
        </View>

        {/* 类型筛选 chips */}
        <View style={styles.filterRow}>
          {filters.map(({ value, label }) => (
            <TouchableOpacity
              key={value}
              activeOpacity={0.7}
              onPress={() => setFilter(value)}
              style={[
                styles.chip,
                filter === value ? styles.chipActive : undefined,
              ]}
            >
              <Text
                style={
                  filter === value ? styles.chipTextActive : styles.chipText
                }
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 条目行流 */}
        <GroupCard>
          {filtered.map((entry, index) => (
            <TouchableOpacity
              key={entry.uid}
              activeOpacity={0.7}
              style={[
                index > 0 ? styles.rowDivided : undefined,
                !entry.enabled ? styles.rowDisabled : undefined,
                styles.row,
              ]}
              onPress={() => setEditing(entry.uid)}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {entry.title}
                </Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {sublineOf(entry)}
                </Text>
              </View>
              <Switch
                value={entry.enabled}
                onValueChange={(v) => handleRowToggle(entry, v)}
                trackColor={{ true: colors.primary, false: colors.border }}
                thumbColor={colors.card}
              />
            </TouchableOpacity>
          ))}
          {filtered.length === 0 ? (
            <Text style={styles.emptyText}>
              {search.trim() ? t('memory.emptySearch') : t('memory.empty')}
            </Text>
          ) : null}
        </GroupCard>

        {/* 计数脚注 */}
        <Text style={styles.countText}>
          {t('memory.countShort', { count: entries.length })}
        </Text>
      </ScrollView>

      {editing !== null ? (
        <MemorySheet
          entry={editingEntry}
          onClose={() => setEditing(null)}
          onSubmit={handleSubmit}
          onDelete={
            typeof editing === 'number'
              ? () => handleDelete(editing)
              : undefined
          }
          onToggleEnabled={
            typeof editing === 'number'
              ? (v) => handleToggleEnabled(editing, v)
              : undefined
          }
        />
      ) : null}
    </View>
  );
};

/** headerRight 的新增按钮，裸图标形态与返回箭头对称 */
function AddButton({ color, onPress }: { color: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      activeOpacity={0.6}
      onPress={onPress}
    >
      <Plus size={22} color={color} />
    </TouchableOpacity>
  );
}

const createStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    listContent: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 24,
    },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surface,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    searchInput: {
      ...typography.content,
      color: colors.text,
      flex: 1,
      paddingVertical: 0,
    },
    filterRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 10,
      marginBottom: 12,
    },
    chip: {
      borderRadius: 999,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderLight,
      paddingHorizontal: 12,
      paddingVertical: 4,
    },
    chipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    chipText: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    chipTextActive: {
      ...typography.caption,
      color: colors.primaryForeground,
      fontWeight: '600',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    rowDivided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderLight,
    },
    rowDisabled: {
      opacity: 0.55,
    },
    rowText: {
      flex: 1,
      minWidth: 0,
    },
    rowTitle: {
      ...typography.content,
      fontWeight: '500',
      color: colors.text,
    },
    rowSub: {
      ...typography.caption,
      color: colors.textTertiary,
      marginTop: 2,
    },
    emptyText: {
      ...typography.content,
      color: colors.textTertiary,
      textAlign: 'center',
      paddingVertical: 24,
    },
    countText: {
      ...typography.caption,
      color: colors.textTertiary,
      textAlign: 'center',
      paddingTop: 10,
    },
  });

export default MemoryScreen;
