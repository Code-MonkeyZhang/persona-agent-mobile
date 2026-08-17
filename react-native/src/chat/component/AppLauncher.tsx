/**
 * @file AppLauncher.tsx
 * @description Agent App 应用网格页面。Stack screen，header 由 Navigator 提供。
 *   点 app → setCurrentAppId + replace 到 AppSurface。
 *   退出网格回聊天时清空 currentAppId（beforeRemove 监听）。
 */
import React, { useEffect } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/index.ts';
import { useAppPanelStore } from '../../stores/appPanelStore';
import { getServerAddress } from '../../storage/StorageUtils.ts';
import { logger } from '../../lib/logger';
import { trigger } from '../util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/index.ts';
import AppIcon from './AppIcon.tsx';
import type { AppInfo } from '../../api/server-api';
import type { RouteParamList } from '../../types/RouteTypes.ts';

const TAG = '[AppLauncher]';

type AppLauncherNav = NativeStackNavigationProp<RouteParamList, 'AppLauncher'>;

const AppLauncher: React.FC = () => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<AppLauncherNav>();
  const apps = useAppPanelStore((s) => s.apps);
  const loadApps = useAppPanelStore((s) => s.loadApps);
  const currentAppId = useAppPanelStore((s) => s.currentAppId);

  useEffect(() => {
    logger.info(`${TAG} mount`);
    loadApps(getServerAddress());
  }, [loadApps]);

  /**
   * 退出网格时清空 currentAppId，使下次点 ▦ 开网格而非恢复 App。
   * replace 到 AppSurface 时不清空（action.type === 'REPLACE'）。
   */
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (e.data.action.type !== 'REPLACE') {
        useAppPanelStore.getState().setCurrentAppId(null);
      }
    });
    return unsubscribe;
  }, [navigation]);

  /**
   * 右上角放当前 App 的图标，点击 replace 回 AppSurface（恢复正在用的 App）。
   * 未选过 App（currentAppId 为空）时不显示——网格就是最新状态，无处可回。
   * replace 触发的 beforeRemove 会被上方守卫跳过，currentAppId 得以保留。
   */
  React.useLayoutEffect(() => {
    navigation.setOptions({
      // eslint-disable-next-line react/no-unstable-nested-components
      headerRight: () =>
        currentAppId ? (
          <TouchableOpacity
            onPress={() => navigation.replace('AppSurface')}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <AppIcon
              name={currentAppId}
              serverAddress={getServerAddress()}
              size={28}
            />
          </TouchableOpacity>
        ) : null,
    });
  }, [navigation, currentAppId]);

  const handleSelect = (name: string) => {
    trigger(HapticFeedbackTypes.selection);
    useAppPanelStore.getState().setCurrentAppId(name);
    navigation.replace('AppSurface');
  };

  const renderItem = ({ item }: { item: AppInfo }) => (
    <TouchableOpacity
      style={styles.cell}
      activeOpacity={0.7}
      onPress={() => handleSelect(item.name)}
    >
      <AppIcon name={item.name} serverAddress={getServerAddress()} size={60} />
      <Text
        style={[styles.appName, { color: colors.text }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {item.name}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {apps.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            {t('appPanel.empty')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={apps}
          keyExtractor={(item) => item.name}
          renderItem={renderItem}
          numColumns={3}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 24,
  },
  cell: {
    width: '33.33%',
    alignItems: 'center',
    marginBottom: 20,
  },
  appName: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
  },
});

export default AppLauncher;
