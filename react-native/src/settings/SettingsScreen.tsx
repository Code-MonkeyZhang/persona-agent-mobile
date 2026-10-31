import * as React from 'react';
import { useState } from 'react';
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
import Share from 'react-native-share';
import {
  ChevronRight,
  Lightbulb,
  ScrollText,
  Vibrate,
  VibrateOff,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { setHapticFeedbackEnabled, trigger } from '../chat/util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/types.ts';
import { getHapticEnabled } from '../storage/StorageUtils.ts';
import { useSettingsStore } from '../stores/settingsStore.ts';
import { logger } from '../lib/logger';

import { useTheme, ColorScheme, typography } from '../theme/index.ts';

/** 设置页通用行骨架，图标与标题说明拼装，行尾控件由调用方注入，带 onPress 时整行可点 */
function Row({
  icon,
  label,
  description,
  trailing,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  trailing: React.ReactNode;
  onPress?: () => void;
}): React.JSX.Element {
  const { colors } = useTheme();
  const styles = createStyles(colors);

  const content = (
    <>
      {icon}
      <View style={styles.rowContent}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDesc}>{description}</Text>
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

/** 开关行，Row 骨架加行尾拨动开关，开关状态和切换逻辑由调用方注入 */
function ToggleRow({
  icon,
  label,
  description,
  value,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  value: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const { colors } = useTheme();
  const styles = createStyles(colors);

  return (
    <Row
      icon={icon}
      label={label}
      description={description}
      trailing={
        <TouchableOpacity
          onPress={onToggle}
          style={[styles.toggle, value && styles.toggleOn]}
        >
          <View style={[styles.toggleKnob, value && styles.toggleKnobOn]} />
        </TouchableOpacity>
      }
    />
  );
}

function SettingsScreen(): React.JSX.Element {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [hapticEnabled, setHapticEnabled] = useState(getHapticEnabled);
  const thoughtProcessVisible = useSettingsStore(
    (s) => s.thoughtProcessVisible
  );
  const setThoughtProcessVisible = useSettingsStore(
    (s) => s.setThoughtProcessVisible
  );

  const toggleHapticFeedback = () => {
    const value = !hapticEnabled;
    setHapticEnabled(value);
    setHapticFeedbackEnabled(value);
    if (value && Platform.OS === 'android') {
      trigger(HapticFeedbackTypes.impactMedium);
    }
  };

  /** 导出运行日志：先落盘缓冲，再取文件清单走系统分享面板 */
  const handleExportLogs = async () => {
    logger.info('[Settings] export logs requested');
    await logger.flush();
    const files = await logger.listFiles();
    if (files.length === 0) {
      logger.warn('[Settings] no log files to export');
      Alert.alert(t('settings.exportLogs'), t('settings.noLogs'));
      return;
    }
    try {
      await Share.open({
        urls: files.map((path) => `file://${path}`),
        failOnCancel: false,
      });
      logger.info(`[Settings] logs shared, count=${files.length}`);
    } catch (e) {
      logger.error('[Settings] log export failed:', e);
      Alert.alert(t('settings.exportLogs'), t('settings.exportFailed'));
    }
  };

  const styles = createStyles(colors);

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView style={styles.container}>
        <View style={styles.card}>
          {/* 震动开关，设备级偏好走本地 MMKV */}
          <ToggleRow
            icon={
              hapticEnabled ? (
                <Vibrate size={19} color={colors.text} />
              ) : (
                <VibrateOff size={19} color={colors.text} />
              )
            }
            label={t('settings.vibration')}
            description={t('settings.vibrationDesc')}
            value={hapticEnabled}
            onToggle={toggleHapticFeedback}
          />
          {/* 思考过程开关，写显示偏好 store 并持久化到 MMKV */}
          <ToggleRow
            icon={<Lightbulb size={19} color={colors.text} />}
            label={t('settings.thoughtProcess')}
            description={t('settings.thoughtProcessDesc')}
            value={thoughtProcessVisible}
            onToggle={() => setThoughtProcessVisible(!thoughtProcessVisible)}
          />
          {/* 日志导出，落盘缓冲后把日志文件交系统分享面板 */}
          <Row
            icon={<ScrollText size={19} color={colors.text} />}
            label={t('settings.exportLogs')}
            description={t('settings.exportLogsDesc')}
            onPress={handleExportLogs}
            trailing={<ChevronRight size={20} color={colors.textTertiary} />}
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
      padding: 16,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.borderLight,
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
    rowDesc: {
      ...typography.body,
      color: colors.textSecondary,
      marginTop: 2,
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
