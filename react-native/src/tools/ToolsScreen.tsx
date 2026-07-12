import * as React from 'react';
import { useCallback, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Wrench } from 'lucide-react-native';
import { useTheme, ColorScheme } from '../theme/index.ts';
import { getServerAddress, getServerAgentId } from '../storage/StorageUtils.ts';
import {
  fetchAgentDetail,
  fetchMcpServers,
  McpServerInfo,
} from '../api/server-api.ts';
import { logger } from '../lib/logger';

/**
 * @file ToolsScreen.tsx
 * @description 工具管理页面。展示当前 agent 分配的 MCP 工具列表。
 */

const ToolsScreen: React.FC = () => {
  const { colors } = useTheme();
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * 加载当前 agent 分配的 MCP 服务器列表。
   * 先取 agent 详情拿到 mcpNames，再取全局 MCP 列表按名字过滤。
   */
  const loadMcpServers = useCallback(async () => {
    const address = getServerAddress();
    const agentId = getServerAgentId();
    if (!address || !agentId) {
      setMcpServers([]);
      setLoading(false);
      return;
    }
    try {
      const [agent, allServers] = await Promise.all([
        fetchAgentDetail(address, agentId),
        fetchMcpServers(address),
      ]);
      const filtered = allServers.filter((s) =>
        agent.mcpNames.includes(s.name)
      );
      logger.info(
        `[Tools] loaded ${filtered.length}/${allServers.length} MCP servers for agent="${agentId}"`
      );
      setMcpServers(filtered);
    } catch (e) {
      logger.error(`[Tools] failed to load MCP servers: ${e}`);
      setMcpServers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadMcpServers();
    }, [loadMcpServers])
  );

  const styles = createStyles(colors);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container}>
        <View style={styles.sectionHeader}>
          <Wrench size={16} color={colors.textSecondary} />
          <Text style={styles.sectionLabel}>MCP Servers</Text>
        </View>
        <View style={styles.card}>
          {mcpServers.length > 0 ? (
            mcpServers.map((server, i) => {
              const connected = server.status === 'connected';
              return (
                <View
                  key={server.name}
                  style={[
                    styles.listItem,
                    i < mcpServers.length - 1 && styles.listItemBorder,
                  ]}
                >
                  <View
                    style={[
                      styles.statusDot,
                      connected ? styles.statusDotOn : styles.statusDotOff,
                    ]}
                  />
                  <View style={styles.listItemContent}>
                    <Text style={styles.listItemTitle}>{server.name}</Text>
                    <Text style={styles.listItemDesc}>
                      {server.toolCount > 0
                        ? `${server.toolCount} tools`
                        : 'Not connected'}
                    </Text>
                  </View>
                </View>
              );
            })
          ) : (
            <Text style={styles.emptyText}>
              {loading ? 'Loading...' : 'No MCP servers assigned'}
            </Text>
          )}
        </View>
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
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.borderLight,
    },
    listItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    listItemBorder: {
      borderBottomWidth: 1,
      borderBottomColor: colors.borderLight,
    },
    listItemContent: {
      flex: 1,
    },
    listItemTitle: {
      fontSize: 15,
      color: colors.text,
    },
    listItemDesc: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    statusDotOn: {
      backgroundColor: colors.success,
    },
    statusDotOff: {
      backgroundColor: colors.textTertiary,
    },
    emptyText: {
      paddingHorizontal: 16,
      paddingVertical: 24,
      textAlign: 'center',
      fontSize: 13,
      color: colors.textTertiary,
    },
  });

export default ToolsScreen;
