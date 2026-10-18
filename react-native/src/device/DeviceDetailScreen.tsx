/**
 * @file device/DeviceDetailScreen.tsx
 * @description 设备详情页，iOS 设置形态。
 *   名称行原地弹改名对话框；设备号、地址、版本与上次连接只读供核对；
 *   红色删除行走系统确认，删的是最后一台时回根栈露首启页。
 */
import * as React from 'react';
import { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronRight, Pencil } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ColorScheme, typography, useTheme } from '../theme/index.ts';
import { useConnectionStore } from '../stores/connectionStore.ts';
import { useDeviceStore } from '../stores/deviceStore.ts';
import type { RouteParamList } from '../types/RouteTypes.ts';
import { deviceDisplayName } from './device-ui.ts';
import InputDialog from './InputDialog.tsx';
import { logger } from '../lib/logger';

type Props = NativeStackScreenProps<RouteParamList, 'DeviceDetail'>;

const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** 上次连接时间的口语化格式：从未连接、今天、昨天与更早日，时间与日期拼接走文案表 */
function formatLastConnected(ts: number, t: TFunction): string {
  if (!ts) {
    return t('device.lastNever');
  }
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const dayOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((dayOf(new Date()) - dayOf(d)) / 86400000);
  if (diffDays === 0) {
    return t('device.lastToday', { time });
  }
  if (diffDays === 1) {
    return t('device.lastYesterday', { time });
  }
  return t('device.lastDate', {
    m: String(d.getMonth() + 1),
    d: String(d.getDate()),
  });
}

const DeviceDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const { hostId } = route.params;

  const devices = useDeviceStore((s) => s.devices);
  const device = devices.find((d) => d.hostId === hostId) ?? null;

  /** 改名对话框的开合与草稿，打开时回填当前标签 */
  const [renameOpen, setRenameOpen] = useState(false);
  const [draft, setDraft] = useState('');

  /** 标题跟随条目显示名，改名后原地刷新 */
  useEffect(() => {
    navigation.setOptions({
      title: device ? deviceDisplayName(device) : '',
    });
  }, [device, navigation]);

  /** 条目已被删除时收层，防御性兜底 */
  if (!device) {
    return null;
  }

  const beginRename = () => {
    setDraft(device.name);
    setRenameOpen(true);
  };

  /** 空草稿按取消处理，不改名 */
  const commitRename = () => {
    if (draft.trim()) {
      useDeviceStore.getState().renameDevice(device.hostId, draft.trim());
    }
    setRenameOpen(false);
  };

  /** 删除确认用系统 Alert，确认后条目与镜像库一起清，删空回根栈露首启页 */
  const handleDeletePress = () => {
    Alert.alert(
      t('device.deleteConfirmTitle', { name: deviceDisplayName(device) }),
      t('device.deleteConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('device.deleteShort'),
          style: 'destructive',
          onPress: () => {
            const wasLast = useDeviceStore.getState().devices.length === 1;
            logger.info(`[DeviceDetail] delete confirmed: ${device.hostId}`);
            useConnectionStore
              .getState()
              .forgetDevice(device.hostId)
              .catch(() => undefined);
            if (wasLast) {
              navigation.popToTop();
            } else {
              navigation.goBack();
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* 名称行：改名入口 */}
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.6}
            onPress={beginRename}
          >
            <Text style={styles.rowLabel}>{t('device.nameRow')}</Text>
            <Text style={styles.rowValue} numberOfLines={1}>
              {device.name}
            </Text>
            <ChevronRight size={17} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>

        {/* 只读标识组：设备号与地址走等宽字形，右对齐超长省略 */}
        <View style={styles.group}>
          <InfoRow
            label={t('device.deviceIdRow')}
            value={device.hostId}
            mono
            divided={false}
          />
          <InfoRow
            label={t('device.addressRow')}
            value={device.address.replace(/^https?:\/\//, '')}
            mono
            divided
          />
          <InfoRow
            label={t('device.versionRow')}
            value={device.version || '-'}
            divided
          />
          <InfoRow
            label={t('device.lastConnectedRow')}
            value={formatLastConnected(device.lastConnectedAt, t)}
            divided
          />
        </View>

        {/* 删除入口：红色行，点了走系统确认 */}
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.dangerRow}
            activeOpacity={0.6}
            onPress={handleDeletePress}
          >
            <Text style={styles.dangerText}>{t('device.deleteDevice')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <InputDialog
        visible={renameOpen}
        title={t('device.rename')}
        icon={<Pencil size={16} color={colors.textTertiary} />}
        value={draft}
        onChange={setDraft}
        onCancel={() => setRenameOpen(false)}
        onConfirm={commitRename}
        confirmLabel={t('device.save')}
        confirmDisabled={!draft.trim()}
      />
    </SafeAreaView>
  );
};

/** 只读信息行：标签在左，值右对齐超长省略，技术标识走等宽字形 */
function InfoRow({
  label,
  value,
  mono,
  divided,
}: {
  label: string;
  value: string;
  mono?: boolean;
  divided?: boolean;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={[styles.row, divided && styles.rowDivider]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={mono ? styles.rowValueMono : styles.rowValue}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 24,
    },
    group: {
      backgroundColor: colors.card,
      borderRadius: 12,
      overflow: 'hidden',
      marginBottom: 18,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 11,
      minHeight: 50,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderLight,
    },
    rowLabel: {
      ...typography.content,
      color: colors.text,
    },
    rowValue: {
      flex: 1,
      ...typography.content,
      color: colors.textSecondary,
      textAlign: 'right',
    },
    rowValueMono: {
      flex: 1,
      fontSize: 12.5,
      fontFamily: MONO_FONT,
      color: colors.textSecondary,
      textAlign: 'right',
    },
    dangerRow: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      minHeight: 50,
    },
    dangerText: {
      ...typography.content,
      color: colors.error,
    },
  });

export default DeviceDetailScreen;
