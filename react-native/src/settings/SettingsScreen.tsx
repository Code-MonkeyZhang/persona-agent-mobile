import * as React from 'react';
import { useState } from 'react';
import {
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Vibrate, VibrateOff } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { setHapticFeedbackEnabled, trigger } from '../chat/util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/index.ts';
import { getHapticEnabled } from '../storage/StorageUtils.ts';

import { useTheme, ColorScheme } from '../theme/index.ts';

function SettingsScreen(): React.JSX.Element {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [hapticEnabled, setHapticEnabled] = useState(getHapticEnabled);

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
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container}>
        <View style={styles.card}>
          {/* 震动开关 */}
          <View style={styles.row}>
            {hapticEnabled ? (
              <Vibrate size={16} color={colors.text} />
            ) : (
              <VibrateOff size={16} color={colors.text} />
            )}
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>{t('settings.vibration')}</Text>
              <Text style={styles.rowDesc}>{t('settings.vibrationDesc')}</Text>
            </View>
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
          </View>
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
      fontSize: 15,
      fontWeight: '500',
      color: colors.text,
    },
    rowDesc: {
      fontSize: 12,
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
      backgroundColor: '#ffffff',
      marginHorizontal: 2,
      alignSelf: 'flex-start',
    },
    toggleKnobOn: {
      alignSelf: 'flex-end',
    },
  });

export default SettingsScreen;
