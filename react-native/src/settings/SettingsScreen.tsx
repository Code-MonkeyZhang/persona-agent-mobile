/**
 * @file settings/SettingsScreen.tsx
 * @description 设置页单页平铺三组：通用、聊天、关于。
 *   通用组收震动、思考过程、呼吸动画与思考气泡，都是设备本地的开关，各设备各管各的。
 *   聊天组收自动压缩与压缩阈值，是两端共享的服务端全局配置。
 *   关于组只有一个带版本号与箭头的入口行，点进关于本项目页。
 */
import * as React from 'react';
import { useEffect, useState } from 'react';
import {
  Alert,
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ChevronRight,
  Info,
  Lightbulb,
  MessageCircleMore,
  Minimize2,
  Vibrate,
  VibrateOff,
  Wind,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import DeviceInfo from 'react-native-device-info';
import { setHapticFeedbackEnabled, trigger } from '../chat/util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/types.ts';
import { getHapticEnabled } from '../storage/StorageUtils.ts';
import { useSettingsStore } from '../stores/settingsStore.ts';
import { useCompressionConfigStore } from '../stores/compressionConfigStore.ts';
import type { CompressionConfig } from '../api/server-api.ts';
import { logger } from '../lib/logger';
import type { RouteParamList } from '../types/RouteTypes.ts';

import { useTheme, ColorScheme, typography } from '../theme/index.ts';

// 安卓需手动启用 LayoutAnimation，阈值行的收展动画依赖它
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type SettingsNavigationProp = NativeStackNavigationProp<
  RouteParamList,
  'Settings'
>;

/** 开关轨道与滑钮的通用视觉，按压回调由宿主注入 */
function Toggle({ on, onPress }: { on: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.toggle, on && styles.toggleOn]}
    >
      <View style={[styles.toggleKnob, on && styles.toggleKnobOn]} />
    </TouchableOpacity>
  );
}

/**
 * 聊天组的压缩偏好节，全局服务端配置不走本地 MMKV。
 * 节首带组头，无配置时组头与卡一起不渲染。
 * 两行，自动压缩开关加阈值行内数字输入，阈值行随开关联动收展，
 * 乐观写本地缓存让界面立即跟随，写回失败回滚并弹提示。
 */
function CompressionSection() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const compression = useCompressionConfigStore(
    (s) => s.appConfig?.compression ?? null
  );
  const applyLocal = useCompressionConfigStore((s) => s.applyLocal);
  const save = useCompressionConfigStore((s) => s.save);
  const load = useCompressionConfigStore((s) => s.load);
  const [thresholdText, setThresholdText] = useState('');

  // 进设置页拉一次全局配置，无配置时偏好节整体不渲染
  useEffect(() => {
    load().catch((e) => {
      logger.warn(
        `[settings] compression config load failed: ${
          e instanceof Error ? e.message : e
        }`
      );
    });
  }, [load]);

  useEffect(() => {
    if (compression) {
      setThresholdText(String(compression.threshold));
    }
  }, [compression]);

  /** 乐观写本地，网络写回失败时回滚旧值并提示 */
  const write = async (next: CompressionConfig) => {
    const prev = compression;
    if (!prev) return;
    applyLocal(next);
    try {
      await save(next);
      logger.info(
        `[settings] compression saved, auto=${next.autoCompress} threshold=${next.threshold}`
      );
    } catch (e) {
      applyLocal(prev);
      logger.warn(
        `[settings] compression save failed: ${
          e instanceof Error ? e.message : e
        }`
      );
      Alert.alert(
        t('agent.updateFailedTitle'),
        t('settings.compressSaveFailed')
      );
    }
  };

  const toggleAuto = () => {
    if (!compression) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    write({ ...compression, autoCompress: !compression.autoCompress });
  };

  /** 阈值落定，非法输入回退现值，合法值钳制 1 到 100 后写回 */
  const commitThreshold = () => {
    if (!compression) return;
    const parsed = parseInt(thresholdText, 10);
    if (!Number.isFinite(parsed)) {
      setThresholdText(String(compression.threshold));
      return;
    }
    const clamped = Math.min(100, Math.max(1, parsed));
    setThresholdText(String(clamped));
    if (clamped !== compression.threshold) {
      write({ ...compression, threshold: clamped });
    }
  };

  if (!compression) {
    return null;
  }

  return (
    <>
      <Text style={styles.sectionTitle}>{t('settings.chat')}</Text>
      <View style={styles.card}>
        <Row
          icon={<Minimize2 size={19} color={colors.text} />}
          label={t('settings.autoCompress')}
          trailing={
            <Toggle on={compression.autoCompress} onPress={toggleAuto} />
          }
        />
        {compression.autoCompress && (
          <View style={[styles.row, styles.rowBorderTop]}>
            <Text style={styles.rowLabel}>
              {t('settings.compressionThreshold')}
            </Text>
            <TextInput
              style={styles.thresholdInput}
              keyboardType="number-pad"
              returnKeyType="done"
              maxLength={3}
              value={thresholdText}
              onChangeText={setThresholdText}
              onEndEditing={commitThreshold}
              onSubmitEditing={commitThreshold}
              accessibilityLabel={t('settings.compressionThreshold')}
            />
          </View>
        )}
      </View>
    </>
  );
}

/** 设置页通用行骨架，图标与标题拼装，行尾控件与整行按压由调用方注入 */
function Row({
  icon,
  label,
  trailing,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
}): React.JSX.Element {
  const { colors } = useTheme();
  const styles = createStyles(colors);

  const content = (
    <>
      {icon}
      <View style={styles.rowContent}>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      {trailing}
    </>
  );

  if (!onPress) {
    return <View style={styles.row}>{content}</View>;
  }
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      {content}
    </TouchableOpacity>
  );
}

function SettingsScreen(): React.JSX.Element {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<SettingsNavigationProp>();
  const [hapticEnabled, setHapticEnabled] = useState(getHapticEnabled);
  const thoughtProcessVisible = useSettingsStore(
    (s) => s.thoughtProcessVisible
  );
  const setThoughtProcessVisible = useSettingsStore(
    (s) => s.setThoughtProcessVisible
  );
  const breathEnabled = useSettingsStore((s) => s.breathEnabled);
  const setBreathEnabled = useSettingsStore((s) => s.setBreathEnabled);
  const thinkingBubbleEnabled = useSettingsStore(
    (s) => s.thinkingBubbleEnabled
  );
  const setThinkingBubbleEnabled = useSettingsStore(
    (s) => s.setThinkingBubbleEnabled
  );

  const toggleHapticFeedback = () => {
    const value = !hapticEnabled;
    setHapticEnabled(value);
    setHapticFeedbackEnabled(value);
    if (value && Platform.OS === 'android') {
      trigger(HapticFeedbackTypes.impactMedium);
    }
  };

  const styles = createStyles(colors);

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      {/* 安卓端 style 上的垂直 padding 会让滚动区底部不可达，padding 挂内容容器 */}
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.sectionTitle}>{t('settings.general')}</Text>
        <View style={styles.card}>
          {/* 震动开关，设备级偏好走本地 MMKV */}
          <Row
            icon={
              hapticEnabled ? (
                <Vibrate size={19} color={colors.text} />
              ) : (
                <VibrateOff size={19} color={colors.text} />
              )
            }
            label={t('settings.vibration')}
            trailing={
              <Toggle on={hapticEnabled} onPress={toggleHapticFeedback} />
            }
          />
          {/* 思考过程开关，写显示偏好 store 并持久化到 MMKV */}
          <Row
            icon={<Lightbulb size={19} color={colors.text} />}
            label={t('settings.thoughtProcess')}
            trailing={
              <Toggle
                on={thoughtProcessVisible}
                onPress={() => setThoughtProcessVisible(!thoughtProcessVisible)}
              />
            }
          />
          {/* 呼吸动画开关，陪伴立绘的常驻起伏，关掉后完全静止 */}
          <Row
            icon={<Wind size={19} color={colors.text} />}
            label={t('settings.breathAnimation')}
            trailing={
              <Toggle
                on={breathEnabled}
                onPress={() => setBreathEnabled(!breathEnabled)}
              />
            }
          />
          {/* 思考气泡开关，生成期间头顶常驻的思考气泡，关掉后情绪气泡照出 */}
          <Row
            icon={<MessageCircleMore size={19} color={colors.text} />}
            label={t('settings.thinkingBubble')}
            trailing={
              <Toggle
                on={thinkingBubbleEnabled}
                onPress={() => setThinkingBubbleEnabled(!thinkingBubbleEnabled)}
              />
            }
          />
        </View>
        {/* 压缩偏好，两端共享的服务端全局配置，节首自带聊天组头 */}
        <CompressionSection />
        <Text style={styles.sectionTitle}>{t('settings.aboutGroup')}</Text>
        {/* 关于入口，行尾带当前版本号与箭头，导出日志与版本信息收在关于页 */}
        <View style={styles.card}>
          <Row
            icon={<Info size={19} color={colors.text} />}
            label={t('about.title')}
            trailing={
              <View style={styles.versionTrail}>
                <Text style={styles.versionText}>
                  {DeviceInfo.getVersion()}
                </Text>
                <ChevronRight size={18} color={colors.textTertiary} />
              </View>
            }
            onPress={() => navigation.navigate('About')}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    container: {
      flex: 1,
    },
    content: {
      padding: 16,
    },
    /** 灰字组头，贴左与卡内文字对齐 */
    sectionTitle: {
      ...typography.meta,
      color: colors.textTertiary,
      marginLeft: 16,
      marginBottom: 8,
    },
    versionTrail: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    versionText: {
      ...typography.titleSection,
      color: colors.textTertiary,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.borderLight,
      marginBottom: 16,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    rowContent: {
      flex: 1,
    },
    rowLabel: {
      ...typography.titleSection,
      fontWeight: '500',
      color: colors.text,
    },
    rowBorderTop: {
      borderTopWidth: 1,
      borderTopColor: colors.borderLight,
    },
    /** 阈值行内数字输入，窄盒右对齐等宽数字 */
    thresholdInput: {
      width: 56,
      textAlign: 'right',
      ...typography.titleSection,
      fontVariant: ['tabular-nums'],
      color: colors.text,
    },
    toggle: {
      width: 40,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.textTertiary,
      justifyContent: 'center',
    },
    toggleOn: {
      backgroundColor: colors.primary,
    },
    toggleKnob: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: colors.card,
      marginHorizontal: 2,
      alignSelf: 'flex-start',
    },
    toggleKnobOn: {
      alignSelf: 'flex-end',
    },
  });

export default SettingsScreen;
