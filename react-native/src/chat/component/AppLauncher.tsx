/**
 * @file AppLauncher.tsx
 * @description Agent App 桌面屏，无 header 的沉浸式全屏，壁纸铺到状态栏底下。
 *   顶部悬浮按钮行，左返回回聊天；其下是时钟与平铺四列网格。
 *   清单未就绪时顶部状态条与骨架格占位，失败红条点按重试，图标统一走 AppTile。
 *   点 app → setCurrentAppId + replace 到 AppSurface；长按图标进入拖拽，
 *   网格由 react-native-reanimated-dnd 托管，swap 策略实时对调格子，
 *   松手按落位表还原成槽位数组落盘，槽位与应用同池排列。
 *   设置槽位打开小手机自己的设置覆盖层，与 App 全局设置互不相干，返回逐层退回桌面。
 *   网格平铺不滚动是设计决定，与真手机桌面固定网格一致，放不下时再演进分页。
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import {
  GridStrategy,
  SortableGrid,
  SortableGridItem,
  type GridPositions,
  type SortableGridRenderItemProps,
} from 'react-native-reanimated-dnd';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { typography } from '../../theme/index.ts';
import { useAppPanelStore } from '../../stores/appPanelStore';
import { getServerAddress } from '../../storage/StorageUtils.ts';
import { logger } from '../../lib/logger';
import { trigger } from '../util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/index.ts';
import AppTile from './AppTile.tsx';
import PhoneStatusStrip from './PhoneStatusStrip.tsx';
import { PhoneChip } from './PhoneAppBar.tsx';
import PhoneWallpaper from './PhoneWallpaper.tsx';
import PhoneClock from './PhoneClock.tsx';
import PhoneSettings from './PhoneSettings.tsx';
import {
  DEFAULT_WALLPAPER,
  resolveWallpaper,
} from '../../data/wallpaperPresets';
import { getWallpaperFileUrl } from '../../api/server-api';
import {
  EMPTY_ID_PREFIX,
  GRID_COLS,
  SETTINGS_SLOT_ID,
  itemsToOrder,
  orderFromPositions,
  padCells,
  toGridItems,
  type GridItem,
} from '../util/launcherOrder.ts';
import type { RouteParamList } from '../../types/RouteTypes.ts';

const TAG = '[AppLauncher]';

/** 长按进入拖拽的等待时长 */
const LONG_PRESS_MS = 300;

/** 网格行距，同时是拖拽库 dimensions 的行距输入 */
const ROW_GAP = 20;

/** 网格左右内边距，格宽由屏宽扣除后四等分 */
const GRID_PAD_X = 8;

/** 网格顶部内边距，时钟与首行图标的间距 */
const GRID_PAD_TOP = 24;

/** 单格固定高度，图标加标签的紧凑包裹值 */
const CELL_ITEM_HEIGHT = 92;

type AppLauncherNav = NativeStackNavigationProp<RouteParamList, 'AppLauncher'>;

const AppLauncher: React.FC = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<AppLauncherNav>();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const apps = useAppPanelStore((s) => s.apps);
  const status = useAppPanelStore((s) => s.status);
  const loadApps = useAppPanelStore((s) => s.loadApps);
  const wallpaperDoc = useAppPanelStore((s) => s.wallpaperDoc);
  const appOrder = useAppPanelStore((s) => s.appOrder);
  /** 设置覆盖层的开关，子页切换状态收在 PhoneSettings 内部 */
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    logger.info(`${TAG} mount`);
    loadApps(getServerAddress());
  }, [loadApps]);

  /** 红条点按立即重拉清单，loadApps 会把 status 置回 loading 触发骨架 */
  const handleRetry = useCallback(() => {
    logger.info(`${TAG} load retry from strip`);
    loadApps(getServerAddress());
  }, [loadApps]);

  /** 壁纸文档解析出渲染来源，预设与自定义图互斥，未命中回落默认底 */
  const resolved = useMemo(
    () =>
      resolveWallpaper(wallpaperDoc, (hash) =>
        getWallpaperFileUrl(hash, getServerAddress())
      ),
    [wallpaperDoc]
  );
  const preset = resolved.preset ?? DEFAULT_WALLPAPER;
  const fg = resolved.dark ? '#ffffff' : '#16202e';

  /** 补格后的展示序，再转成拖拽库的条目模型 */
  const items = useMemo(() => toGridItems(padCells(appOrder, 16)), [appOrder]);

  /** 拖拽库的网格几何输入，格宽按屏宽扣除左右内边距后四等分 */
  const dimensions = useMemo(
    () => ({
      columns: GRID_COLS,
      itemWidth: (windowWidth - GRID_PAD_X * 2) / GRID_COLS,
      itemHeight: CELL_ITEM_HEIGHT,
      rowGap: ROW_GAP,
      columnGap: 0,
    }),
    [windowWidth]
  );

  /**
   * 松手把落位表还原成槽位数组提交。
   * 网格的 swap 是累积式交换，只有按全量落位表重建才是用户看到的终局。
   */
  const handleDrop = useCallback(
    (_id: string, _position: number, allPositions?: GridPositions) => {
      if (!allPositions) return;
      const next = itemsToOrder(orderFromPositions(items, allPositions));
      useAppPanelStore.getState().applyOrder(next);
    },
    [items]
  );

  const handleSelect = useCallback(
    (name: string) => {
      trigger(HapticFeedbackTypes.selection);
      useAppPanelStore.getState().setCurrentAppId(name);
      navigation.replace('AppSurface');
    },
    [navigation]
  );

  /** 返回回聊天 */
  const handleBack = () => {
    logger.info(`${TAG} back pressed`);
    navigation.goBack();
  };

  /** 单格渲染，空位与对不上清单的 id 画占位空格，其余画可点可拖的图标格 */
  const renderItem = useCallback(
    ({ item, ...rest }: SortableGridRenderItemProps<GridItem>) => {
      const appId = item.id.startsWith(EMPTY_ID_PREFIX) ? null : item.id;
      const isSlot = appId === SETTINGS_SLOT_ID;
      const app = appId ? apps.find((a) => a.name === appId) : undefined;
      const known = isSlot || app !== undefined;
      const label = isSlot
        ? t('home.settings')
        : app?.displayName ?? appId ?? '';
      const icon = isSlot ? (
        <AppTile kind="settings" size={56} />
      ) : app ? (
        <AppTile
          name={app.name}
          label={app.displayName}
          logoUrl={app.logoUrl}
          size={56}
        />
      ) : null;
      return (
        <SortableGridItem
          key={item.id}
          data={item}
          {...rest}
          activationDelay={LONG_PRESS_MS}
          onDragStart={() => trigger(HapticFeedbackTypes.impactMedium)}
          onDrop={handleDrop}
        >
          {known ? (
            <TouchableOpacity
              style={styles.cellInner}
              activeOpacity={0.7}
              onPress={() => {
                if (isSlot) setSettingsOpen(true);
                else if (appId) handleSelect(appId);
              }}
            >
              {icon}
              <Text style={[styles.appName, { color: fg }]} numberOfLines={1}>
                {label}
              </Text>
            </TouchableOpacity>
          ) : (
            <View />
          )}
        </SortableGridItem>
      );
    },
    [apps, fg, handleDrop, handleSelect, t]
  );

  /**
   * 四态判据。apps 非空静默刷新不闪骨架，空清单按 status 出三条，
   * ready 且空清单才是真空态说暂无。
   */
  const strip =
    apps.length > 0 ? null : status === 'loading' ? (
      <PhoneStatusStrip kind="loading" text={t('phone.loading')} />
    ) : status === 'error' ? (
      <PhoneStatusStrip
        kind="error"
        text={t('phone.loadFailed')}
        onPress={handleRetry}
      />
    ) : (
      <PhoneStatusStrip kind="quiet" text={t('phone.emptyHint')} />
    );

  return (
    <View style={styles.container}>
      <PhoneWallpaper preset={preset} imageUrl={resolved.imageUrl} />
      {Platform.OS === 'ios' && (
        <StatusBar
          barStyle={
            settingsOpen || !resolved.dark ? 'dark-content' : 'light-content'
          }
        />
      )}
      <View style={[styles.content, { paddingTop: insets.top }]}>
        {/*
         * 顶部状态条，在途蓝条、失败红条、真空灰条，安全区让位由 content 承担，
         * 无条时悬浮行直接顶到安全区下沿。
         */}
        {strip}
        {/* 顶部悬浮行，左返回回聊天 */}
        <View style={styles.fabRow}>
          <PhoneChip onPress={handleBack}>
            <ChevronLeft size={22} color="#ffffff" />
          </PhoneChip>
        </View>
        <View style={styles.clockWrap}>
          <PhoneClock dark={resolved.dark} />
        </View>
        {apps.length > 0 ? (
          <SortableGrid
            data={items}
            renderItem={renderItem}
            dimensions={dimensions}
            strategy={GridStrategy.Swap}
            scrollEnabled={false}
            style={styles.grid}
            contentContainerStyle={styles.gridContent}
          />
        ) : (
          <StaticGrid
            loading={status === 'loading'}
            itemWidth={(windowWidth - GRID_PAD_X * 2) / GRID_COLS}
            settingsLabel={t('home.settings')}
            fg={fg}
            onSettings={() => setSettingsOpen(true)}
          />
        )}
      </View>
      {settingsOpen && <PhoneSettings onClose={() => setSettingsOpen(false)} />}
    </View>
  );
};

/** 静态网格单格外框，格宽与拖拽网格同公式由屏宽四等分传入 */
function SettingsCell({
  width,
  label,
  fg,
  onPress,
}: {
  width: number;
  label: string;
  fg: string;
  onPress: () => void;
}) {
  return (
    <View style={[styles.staticCell, { width }]}>
      <TouchableOpacity
        style={styles.cellInner}
        activeOpacity={0.7}
        onPress={onPress}
      >
        <AppTile kind="settings" size={56} />
        <Text style={[styles.appName, { color: fg }]} numberOfLines={1}>
          {label}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/** 骨架格，图标与标签两段同相透明度脉冲循环占位 */
function SkeletonCell({ width }: { width: number }) {
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 650,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);
  return (
    <View style={[styles.staticCell, { width }]}>
      <Animated.View style={[styles.skeletonTile, { opacity: pulse }]} />
      <Animated.View style={[styles.skeletonLabel, { opacity: pulse }]} />
    </View>
  );
}

/**
 * 非就绪态的静态网格。设置是本地内置不依赖服务器照常在场可点，
 * loading 补七格骨架占满两行，error 与真空态只有设置一行，无内容可拖不挂拖拽库。
 */
function StaticGrid({
  loading,
  itemWidth,
  settingsLabel,
  fg,
  onSettings,
}: {
  loading: boolean;
  itemWidth: number;
  settingsLabel: string;
  fg: string;
  onSettings: () => void;
}) {
  return (
    <View style={styles.staticGrid}>
      <SettingsCell
        width={itemWidth}
        label={settingsLabel}
        fg={fg}
        onPress={onSettings}
      />
      {loading
        ? Array.from({ length: 7 }, (_, i) => (
            <SkeletonCell key={`skeleton-${i}`} width={itemWidth} />
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  fabRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 16,
  },
  clockWrap: {
    marginTop: 24,
  },
  grid: {
    flex: 1,
  },
  gridContent: {
    paddingHorizontal: GRID_PAD_X,
    paddingTop: GRID_PAD_TOP,
    paddingBottom: 24,
  },
  staticGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: GRID_PAD_X,
    paddingTop: GRID_PAD_TOP,
  },
  staticCell: {
    height: CELL_ITEM_HEIGHT,
    alignItems: 'center',
  },
  skeletonTile: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: 'rgba(22,32,46,0.08)',
  },
  skeletonLabel: {
    width: 34,
    height: 8,
    borderRadius: 4,
    marginTop: 8,
    backgroundColor: 'rgba(22,32,46,0.08)',
  },
  cellInner: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    padding: 4,
  },
  appName: {
    ...typography.content,
    marginTop: 8,
    textAlign: 'center',
  },
});

export default AppLauncher;
