import * as React from 'react';
import { useCallback, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Sparkles } from 'lucide-react-native';
import { useTheme, ColorScheme } from '../theme/index.ts';
import { getServerAddress, getServerAgentId } from '../storage/StorageUtils.ts';
import { fetchAgentDetail, fetchSkills, SkillInfo } from '../api/server-api.ts';
import { logger } from '../lib/logger';

/**
 * @file SkillsScreen.tsx
 * @description 技能展示页面。展示当前 agent 已分配的技能列表。
 */

const SkillsScreen: React.FC = () => {
  const { colors } = useTheme();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * 加载当前 agent 已分配的技能列表。
   * 先取 agent 详情拿到 skillNames，再取全局技能列表按名字过滤。
   */
  const loadSkills = useCallback(async () => {
    const address = getServerAddress();
    const agentId = getServerAgentId();
    if (!address || !agentId) {
      setSkills([]);
      setLoading(false);
      return;
    }
    try {
      const [agent, allSkills] = await Promise.all([
        fetchAgentDetail(address, agentId),
        fetchSkills(address),
      ]);
      const filtered = allSkills.filter((s) =>
        agent.skillNames.includes(s.name)
      );
      logger.info(
        `[Skills] loaded ${filtered.length}/${allSkills.length} skills for agent="${agentId}"`
      );
      setSkills(filtered);
    } catch (e) {
      logger.error(`[Skills] failed to load skills: ${e}`);
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadSkills();
    }, [loadSkills])
  );

  const styles = createStyles(colors);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container}>
        <View style={styles.sectionHeader}>
          <Sparkles size={16} color={colors.textSecondary} />
          <Text style={styles.sectionLabel}>Assigned Skills</Text>
        </View>
        {skills.length > 0 ? (
          skills.map((skill) => (
            <View key={skill.name} style={styles.card}>
              <Text style={styles.cardTitle}>{skill.name}</Text>
              {skill.description ? (
                <Text style={styles.cardDesc} numberOfLines={2}>
                  {skill.description}
                </Text>
              ) : null}
            </View>
          ))
        ) : (
          <View style={styles.card}>
            <Text style={styles.emptyText}>
              {loading ? 'Loading...' : 'No skills assigned'}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    container: {
      flex: 1,
      padding: 16,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginLeft: 16,
      marginBottom: 8,
    },
    sectionLabel: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.borderLight,
    },
    cardTitle: {
      fontSize: 15,
      fontWeight: '500',
      color: colors.text,
    },
    cardDesc: {
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: 4,
    },
    emptyText: {
      textAlign: 'center',
      fontSize: 13,
      color: colors.textTertiary,
      paddingVertical: 8,
    },
  });

export default SkillsScreen;
