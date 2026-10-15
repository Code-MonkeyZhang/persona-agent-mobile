/**
 * @file component/PhoneSettings.tsx
 * @description 小手机内部设置的覆盖层。壁纸与桌面布局这类小手机自身偏好在此配置，
 *   以覆盖层接管 AppLauncher 全屏，子页在内部切换，返回逐层退回，退无可退回小手机桌面。
 *   顶栏 PhoneAppBar 与 AppSurface 同一副面孔，左钮逐层退右钮直回桌面。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  Image as ImageIcon,
  LayoutGrid,
} from 'lucide-react-native';
import { typography, useTheme } from '../../theme/index.ts';
import { useAppPanelStore } from '../../stores/appPanelStore';
import {
  DEFAULT_WALLPAPER,
  resolveWallpaper,
} from '../../data/wallpaperPresets';
import { getWallpaperFileUrl } from '../../api/server-api';
import { getServerAddress } from '../../storage/StorageUtils.ts';
import { logger } from '../../lib/logger';
import { WallpaperSwatch } from './PhoneWallpaper.tsx';
import PhoneWallpaperPage from './PhoneWallpaperPage.tsx';
import AppTile from './AppTile.tsx';
import PhoneAppBar from './PhoneAppBar.tsx';

const TAG = '[PhoneSettings]';

type SettingsPage = 'settings' | 'wallpaper';

interface SettingsRowProps {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  /** 当前壁纸缩略图，传入时渲染在行尾 */
  thumb?: React.ReactNode;
  onPress: () => void;
}

/** iOS 设置风格的单行配置项 */
function SettingsRow({
  icon,
  iconBg,
  label,
  value,
  thumb,
  onPress,
}: SettingsRowProps) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.6} onPress={onPress}>
      <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>{icon}</View>
      <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
      <Text
        style={[styles.rowValue, { color: colors.textTertiary }]}
        numberOfLines={1}
      >
        {value}
      </Text>
      {thumb}
      <ChevronRight size={16} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

/** 小手机设置覆盖层，onClose 逐层退回后由 AppLauncher 卸载 */
const PhoneSettings: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [page, setPage] = useState<SettingsPage>('settings');
  const wallpaperDoc = useAppPanelStore((s) => s.wallpaperDoc);

  /** 入场淡入加轻微放大，对齐桌面端覆盖层的进场观感 */
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    logger.info(`${TAG} open`);
    Animated.spring(appear, {
      toValue: 1,
      useNativeDriver: true,
      friction: 9,
      tension: 90,
    }).start();
  }, [appear]);

  /** 壁纸行的缩略图，预设与自定义图共用一个渲染来源 */
  const resolved = resolveWallpaper(wallpaperDoc, (hash) =>
    getWallpaperFileUrl(hash, getServerAddress())
  );
  const thumb = (
    <WallpaperSwatch
      width={20}
      height={34}
      radius={5}
      preset={resolved.preset ?? DEFAULT_WALLPAPER}
      imageUrl={resolved.imageUrl}
    />
  );

  /** 当前壁纸展示名，预设走 i18n 键，自定义走条目名，其余回落默认底 */
  const currentName = resolved.nameKey
    ? t(resolved.nameKey)
    : resolved.customName ?? t('wallpaper.default');

  /** 重置排列为空文档，对账后回到清单原序，随后退回桌面 */
  const handleResetLayout = () => {
    logger.info(`${TAG} reset layout`);
    useAppPanelStore.getState().applyOrder([]);
    onClose();
  };

  /** 顶栏左钮逐层退，壁纸子页退设置主页，主页退回桌面 */
  const handleBarBack = () => {
    logger.info(`${TAG} bar back, page=${page}`);
    if (page === 'wallpaper') {
      setPage('settings');
    } else {
      onClose();
    }
  };

  /** 顶栏右钮任何时候直回桌面 */
  const handleBarClose = () => {
    logger.info(`${TAG} bar close`);
    onClose();
  };

  const animatedStyle = {
    opacity: appear,
    transform: [
      {
        scale: appear.interpolate({
          inputRange: [0, 1],
          outputRange: [0.96, 1],
        }),
      },
    ],
  };

  return (
    <Animated.View
      style={[
        styles.overlay,
        animatedStyle,
        { backgroundColor: colors.background },
      ]}
    >
      {/*
       * 实体顶栏占位居首，设置主页与壁纸子页作为流式子节点直接排其下。
       */}
      <PhoneAppBar
        title={page === 'wallpaper' ? t('wallpaper.title') : t('home.settings')}
        tile={<AppTile kind="settings" size={24} />}
        onBack={handleBarBack}
        onGrid={handleBarClose}
      />
      {page === 'settings' ? (
        <ScrollView style={styles.body}>
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.borderLight,
              },
            ]}
          >
            <SettingsRow
              icon={<ImageIcon size={15} color="#e8590c" />}
              iconBg="#fff4e6"
              label={t('wallpaper.title')}
              value={currentName}
              thumb={thumb}
              onPress={() => setPage('wallpaper')}
            />
            <View
              style={[styles.divider, { backgroundColor: colors.borderLight }]}
            />
            <SettingsRow
              icon={<LayoutGrid size={15} color="#1971c2" />}
              iconBg="#e7f1ff"
              label={t('phone.resetLayout')}
              value={t('phone.resetLayoutDesc')}
              onPress={handleResetLayout}
            />
          </View>
          <Text style={[styles.note, { color: colors.textTertiary }]}>
            {t('phone.settingsNote')}
          </Text>
        </ScrollView>
      ) : (
        <PhoneWallpaperPage />
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  body: {
    flex: 1,
    padding: 14,
  },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  rowIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    ...typography.content,
    flex: 1,
  },
  rowValue: {
    ...typography.caption,
    maxWidth: 110,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 48,
  },
  note: {
    ...typography.caption,
    lineHeight: 18,
    paddingHorizontal: 8,
    marginTop: 10,
  },
});

export default PhoneSettings;
