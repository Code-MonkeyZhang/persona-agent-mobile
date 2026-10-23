/**
 * @file device/DeviceManageScreen.tsx
 * @description 设备管理页，iOS 设置形态。
 *   分组卡平铺设备行，指示灯在状态文字左侧，状态点回答这台设备现在能不能连上；
 *   当前项排首位加粗，点行切换留在本页，进度由内嵌横幅播完；
 *   页面可见期间对全部设备按间隔探测轮询，结论决定非当前行的红绿；
 *   每行 ⓘ 压栈进详情页，改名与删除收进详情；底部扫码添加与输入地址，
 *   手输弹居中对话框，连接发起后交回内嵌横幅播进度。
 */
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link as LinkIcon, ScanLine } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ColorScheme, typography, useTheme } from '../theme/index.ts';
import { useConnectionStore } from '../stores/connectionStore.ts';
import { useDeviceStore } from '../stores/deviceStore.ts';
import type { DeviceEntry } from '../storage/StorageUtils.ts';
import type { RouteParamList } from '../types/RouteTypes.ts';
import {
  deviceDotColors,
  deviceDotStatus,
  deviceRowStatus,
  deviceDisplayName,
  type DeviceRowStatus,
} from './device-ui.ts';
import InputDialog from './InputDialog.tsx';
import { logger } from '../lib/logger';

type DeviceManageNavigationProp = NativeStackNavigationProp<
  RouteParamList,
  'DeviceManage'
>;

const DeviceManageScreen: React.FC = () => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<DeviceManageNavigationProp>();
  const styles = createStyles(colors);

  const devices = useDeviceStore((s) => s.devices);
  const currentHostId = useDeviceStore((s) => s.currentHostId);
  const status = useConnectionStore((s) => s.status);
  const serverAddress = useConnectionStore((s) => s.serverAddress);
  const probes = useConnectionStore((s) => s.probes);
  const pendingHostId = useConnectionStore((s) => s.pendingHostId);

  /** 手输地址对话框的开合、草稿与失败提示，草稿在打开时回填当前地址 */
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogUrl, setDialogUrl] = useState('');
  const [dialogError, setDialogError] = useState('');

  const current = devices.find((d) => d.hostId === currentHostId) ?? null;
  const others = devices.filter((d) => d.hostId !== currentHostId);

  /** 连接链在途，对话框确认键的禁用与文案随之切换 */
  const connecting = status === 'connecting' || status === 'reconnecting';

  // 页面可见期间驱动探测轮询，挂载即查一轮，卸载即停
  useEffect(() => useConnectionStore.getState().startProbing(), []);

  /** 行状态两段裁决，清单与探测结论定四态，再映射颜色与文案 */
  const rowStatus = (
    device: DeviceEntry,
    isCurrent: boolean
  ): DeviceRowStatus =>
    deviceRowStatus(
      deviceDotStatus(device, { currentHostId, pendingHostId, status, probes }),
      isCurrent
    );

  /** 点其他行切换、点当前行刷新链路，都不离页，在途守卫在 store，进度由行状态点原地播完 */
  const handleSwitch = (hostId: string) => {
    useConnectionStore
      .getState()
      .switchDevice(hostId)
      .catch(() => undefined);
  };

  /** 打开对话框并回填当前地址，扫过码换的地址也能带进来 */
  const openInput = () => {
    setDialogUrl(serverAddress);
    setDialogError('');
    setDialogOpen(true);
  };

  /** 对话框内发起手输连接走 connectByAddress 四阶段链，成功收层，失败留在原地点出红字 */
  const runConnect = async () => {
    const target = dialogUrl.trim();
    if (!target) {
      return;
    }
    setDialogError('');
    logger.info(`[DeviceManage] manual connect: ${target}`);
    const ok = await useConnectionStore
      .getState()
      .connectByAddress(target)
      .catch(() => false);
    if (ok) {
      setDialogOpen(false);
      return;
    }
    setDialogError(t('home.connFailed'));
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* 分组卡：当前项排首位加粗，行点换设备或刷新当前链路，ⓘ 压栈进详情 */}
        <View style={styles.group}>
          {current && (
            <DeviceRow
              device={current}
              bold
              status={rowStatus(current, true)}
              onRowPress={() => handleSwitch(current.hostId)}
              onInfo={() =>
                navigation.navigate('DeviceDetail', { hostId: current.hostId })
              }
            />
          )}
          {others.map((device) => (
            <DeviceRow
              key={device.hostId}
              device={device}
              divided
              status={rowStatus(device, false)}
              onRowPress={() => handleSwitch(device.hostId)}
              onInfo={() =>
                navigation.navigate('DeviceDetail', { hostId: device.hostId })
              }
            />
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.scanBtn}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('ScanQR')}
        >
          <ScanLine size={19} color={colors.primaryForeground} />
          <Text style={styles.scanText}>{t('device.scanAdd')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.inputEntryBtn}
          activeOpacity={0.6}
          onPress={openInput}
        >
          <Text style={styles.inputEntryText}>{t('device.inputAddress')}</Text>
        </TouchableOpacity>
      </View>

      <InputDialog
        visible={dialogOpen}
        title={t('device.inputAddress')}
        icon={<LinkIcon size={17} color={colors.textTertiary} />}
        value={dialogUrl}
        onChange={setDialogUrl}
        onCancel={() => setDialogOpen(false)}
        onConfirm={runConnect}
        confirmLabel={connecting ? t('server.connecting') : t('server.connect')}
        confirmDisabled={connecting || !dialogUrl.trim()}
        error={dialogError}
        placeholder={t('server.placeholder')}
        keyboardType="url"
      />
    </SafeAreaView>
  );
};

/** 分组卡内的设备行：名字加状态副文案，点行切换，ⓘ 压栈进详情 */
function DeviceRow({
  device,
  bold,
  divided,
  status,
  onRowPress,
  onInfo,
}: {
  device: DeviceEntry;
  bold?: boolean;
  divided?: boolean;
  status: DeviceRowStatus;
  onRowPress?: () => void;
  onInfo: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const dotColors = deviceDotColors(colors);
  return (
    <View style={[styles.row, divided && styles.rowDivider]}>
      <TouchableOpacity
        style={styles.rowPress}
        activeOpacity={0.6}
        onPress={onRowPress}
        disabled={!onRowPress}
      >
        <Text
          style={bold ? styles.rowNameBold : styles.rowName}
          numberOfLines={1}
        >
          {deviceDisplayName(device)}
        </Text>
        <View style={styles.rowSub}>
          <StatusDot color={dotColors[status.color]} pulse={status.pulse} />
          <Text style={styles.rowSubText}>{t(status.textKey)}</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.infoBtn}
        activeOpacity={0.6}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        onPress={onInfo}
        accessibilityLabel={t('device.detailA11y')}
      >
        <Text style={styles.infoText}>i</Text>
      </TouchableOpacity>
    </View>
  );
}

/** 状态点：连接中时脉动，其余颜色静态 */
function StatusDot({ color, pulse }: { color: string; pulse: boolean }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulse) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, opacity]);
  return (
    <Animated.View style={[styles.dot, { backgroundColor: color, opacity }]} />
  );
}

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    list: {
      flex: 1,
    },
    listContent: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 12,
    },
    group: {
      backgroundColor: colors.card,
      borderRadius: 12,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 10,
      minHeight: 58,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderLight,
    },
    rowPress: {
      flex: 1,
      minWidth: 0,
    },
    rowName: {
      ...typography.content,
      fontWeight: '500',
      color: colors.text,
    },
    rowNameBold: {
      ...typography.content,
      fontWeight: '700',
      color: colors.text,
    },
    rowSub: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 3,
    },
    rowSubText: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    infoBtn: {
      width: 21,
      height: 21,
      borderRadius: 11,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 10,
    },
    infoText: {
      fontSize: 13,
      fontWeight: '600',
      fontStyle: 'italic',
      color: colors.primaryForeground,
    },
    footer: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 20,
    },
    scanBtn: {
      height: 46,
      borderRadius: 14,
      backgroundColor: colors.primary,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    scanText: {
      ...typography.body,
      fontWeight: '600',
      color: colors.primaryForeground,
    },
    inputEntryBtn: {
      height: 46,
      marginTop: 10,
      borderRadius: 14,
      backgroundColor: colors.primarySelectedBackground,
      borderWidth: 1,
      borderColor: colors.primaryBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inputEntryText: {
      ...typography.body,
      fontWeight: '500',
      color: colors.primary,
    },
  });

export default DeviceManageScreen;
