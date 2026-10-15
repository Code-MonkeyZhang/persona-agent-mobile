/**
 * @file component/PhoneWallpaperPage.tsx
 * @description 小手机内部设置里的壁纸子页。预设区点击即设当前，默认底也是一项；
 *   自定义区缩略图列表可设可删，上传走压缩管线出主图与缩略图后直发服务端。
 *   读写全部经 appPanelStore 与 launcher-prefs，页面自身不落盘。
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Trash2, Upload } from 'lucide-react-native';
import { typography, useTheme } from '../../theme/index.ts';
import { useAppPanelStore } from '../../stores/appPanelStore';
import { launcherPrefs } from '../../storage/sync-setup.ts';
import {
  DEFAULT_WALLPAPER,
  WALLPAPER_PRESETS,
  type WallpaperPreset,
} from '../../data/wallpaperPresets';
import { WallpaperSwatch } from './PhoneWallpaper.tsx';
import { prepareWallpaperUpload } from '../util/wallpaperUpload.ts';
import {
  deleteLauncherWallpaperImage,
  getWallpaperFileUrl,
  uploadLauncherWallpaper,
} from '../../api/server-api';
import { getServerAddress } from '../../storage/StorageUtils.ts';
import { logger } from '../../lib/logger';

const TAG = '[PhoneWallpaperPage]';

const PhoneWallpaperPage: React.FC = (): React.JSX.Element => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const wallpaperDoc = useAppPanelStore((s) => s.wallpaperDoc);
  const setWallpaper = useAppPanelStore((s) => s.setWallpaper);
  const [uploading, setUploading] = useState(false);

  const serverAddress = getServerAddress();
  const currentId = wallpaperDoc?.currentId ?? null;
  const customs = wallpaperDoc?.customs ?? [];

  /** 选图压缩后直发，回包即时落地并自动把新图设为当前 */
  const handleUpload = async () => {
    if (uploading) return;
    const prepared = await prepareWallpaperUpload();
    if (prepared.status === 'cancelled') return;
    if (prepared.status === 'tooSmall') {
      Alert.alert(t('wallpaper.tooSmall'));
      return;
    }
    setUploading(true);
    try {
      const prevIds = new Set(customs.map((c) => c.id));
      const entry = await uploadLauncherWallpaper(serverAddress, prepared.pair);
      launcherPrefs.applyWallpaperEntry(entry);
      const added = entry.payload.customs.find((c) => !prevIds.has(c.id));
      if (added) {
        setWallpaper(added.id);
      }
      logger.info(`${TAG} uploaded wallpaper ${added?.id}`);
    } catch (e) {
      logger.error(`${TAG} upload failed: ${e}`);
      Alert.alert(t('wallpaper.uploadFailed'), String(e));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const entry = await deleteLauncherWallpaperImage(serverAddress, id);
      launcherPrefs.applyWallpaperEntry(entry);
      logger.info(`${TAG} removed wallpaper ${id}`);
    } catch (e) {
      logger.error(`${TAG} remove failed: ${e}`);
      Alert.alert(t('wallpaper.deleteFailed'));
    }
  };

  const presetItem = (id: string | null, preset: WallpaperPreset) => (
    <TouchableOpacity
      key={id ?? 'default'}
      style={styles.presetWrap}
      onPress={() => setWallpaper(id)}
    >
      <WallpaperSwatch
        width={92}
        height={140}
        radius={14}
        preset={preset}
        selected={currentId === id}
      />
      <Text style={[styles.presetName, { color: colors.textSecondary }]}>
        {t(preset.nameKey)}
      </Text>
    </TouchableOpacity>
  );

  const presetRow = [presetItem(null, DEFAULT_WALLPAPER)].concat(
    WALLPAPER_PRESETS.map((p) => presetItem(p.id, p))
  );

  return (
    <ScrollView style={styles.container}>
      <Text style={[styles.section, { color: colors.textSecondary }]}>
        {t('wallpaper.presets')}
      </Text>
      <View style={styles.presetRow}>{presetRow}</View>

      <Text style={[styles.section, { color: colors.textSecondary }]}>
        {t('wallpaper.customs')}
      </Text>
      <TouchableOpacity
        style={[styles.uploadBtn, { backgroundColor: colors.primary }]}
        onPress={handleUpload}
        disabled={uploading}
      >
        {uploading ? (
          <ActivityIndicator size="small" color={colors.primaryForeground} />
        ) : (
          <Upload size={18} color={colors.primaryForeground} />
        )}
        <Text style={[styles.uploadText, { color: colors.primaryForeground }]}>
          {t('wallpaper.upload')}
        </Text>
      </TouchableOpacity>

      {customs.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textTertiary }]}>
          {t('wallpaper.empty')}
        </Text>
      ) : (
        customs.map((custom) => (
          <TouchableOpacity
            key={custom.id}
            style={[
              styles.row,
              {
                backgroundColor: colors.card,
                borderColor:
                  currentId === custom.id ? colors.primary : colors.borderLight,
              },
            ]}
            onPress={() => setWallpaper(custom.id)}
          >
            <WallpaperSwatch
              width={38}
              height={60}
              radius={8}
              preset={DEFAULT_WALLPAPER}
              imageUrl={getWallpaperFileUrl(custom.thumbHash, serverAddress)}
            />
            <Text
              style={[styles.rowName, { color: colors.text }]}
              numberOfLines={1}
            >
              {custom.name ?? custom.id}
            </Text>
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => handleDelete(custom.id)}
            >
              <Trash2 size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  section: {
    ...typography.titleSection,
    marginBottom: 10,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 22,
  },
  presetWrap: {
    alignItems: 'center',
    gap: 6,
  },
  presetName: {
    fontSize: 12,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 13,
    marginBottom: 12,
  },
  uploadText: {
    ...typography.body,
    fontWeight: '600',
  },
  empty: {
    ...typography.body,
    textAlign: 'center',
    paddingVertical: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  rowName: {
    ...typography.body,
    flex: 1,
  },
  deleteBtn: {
    padding: 8,
  },
});

export default PhoneWallpaperPage;
