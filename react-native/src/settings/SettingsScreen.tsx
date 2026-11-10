import * as React from 'react';
import { useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Info, Lightbulb, Vibrate, VibrateOff } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { setHapticFeedbackEnabled, trigger } from '../chat/util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/types.ts';
import { getHapticEnabled } from '../storage/StorageUtils.ts';
import { useSettingsStore } from '../stores/settingsStore.ts';
import type { RouteParamList } from '../types/RouteTypes.ts';

import { useTheme, ColorScheme, typography } from '../theme/index.ts';

type SettingsNavigationProp = NativeStackNavigationProp<
  RouteParamList,
  'Settings'
>;

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
              <TouchableOpacity
                onPress={toggleHapticFeedback}
                style={[styles.toggle, hapticEnabled && styles.toggleOn]}
              >
                <View
                  style={[
                    styles.toggleKnob,
                    hapticEnabled && styles.toggleKnobOn,
                  ]}
                />
              </TouchableOpacity>
            }
          />
          {/* 思考过程开关，写显示偏好 store 并持久化到 MMKV */}
          <Row
            icon={<Lightbulb size={19} color={colors.text} />}
            label={t('settings.thoughtProcess')}
            trailing={
              <TouchableOpacity
                onPress={() => setThoughtProcessVisible(!thoughtProcessVisible)}
                style={[
                  styles.toggle,
                  thoughtProcessVisible && styles.toggleOn,
                ]}
              >
                <View
                  style={[
                    styles.toggleKnob,
                    thoughtProcessVisible && styles.toggleKnobOn,
                  ]}
                />
              </TouchableOpacity>
            }
          />
        </View>
        {/* 关于入口，导出日志与版本信息收在关于页 */}
        <View style={styles.card}>
          <Row
            icon={<Info size={19} color={colors.text} />}
            label={t('about.title')}
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
