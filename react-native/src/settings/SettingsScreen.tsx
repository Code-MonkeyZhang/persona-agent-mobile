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
import { NavigationProp, useNavigation } from '@react-navigation/native';
import { Globe, Vibrate, VibrateOff } from 'lucide-react-native';
import { setHapticFeedbackEnabled, trigger } from '../chat/util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/index.ts';
import { getHapticEnabled } from '../storage/StorageUtils.ts';
import { CustomHeaderRightButton } from '../chat/component/CustomHeaderRightButton.tsx';
import { RouteParamList } from '../types/RouteTypes.ts';

import { useTheme, ColorScheme } from '../theme/index.ts';

type Language = 'zh' | 'en';

function SettingsScreen(): React.JSX.Element {
  const { colors, isDark } = useTheme();
  const [hapticEnabled, setHapticEnabled] = useState(getHapticEnabled);
  const [language, setLanguage] = useState<Language>('zh');
  const navigation = useNavigation<NavigationProp<RouteParamList>>();

  const toggleHapticFeedback = () => {
    const value = !hapticEnabled;
    setHapticEnabled(value);
    setHapticFeedbackEnabled(value);
    if (value && Platform.OS === 'android') {
      trigger(HapticFeedbackTypes.impactMedium);
    }
  };

  React.useLayoutEffect(() => {
    navigation.setOptions({
      // eslint-disable-next-line react/no-unstable-nested-components
      headerRight: () => (
        <CustomHeaderRightButton
          onPress={async () => {
            navigation.navigate('Bedrock', {
              sessionId: '',
              tapIndex: -1,
            });
          }}
          imageSource={
            isDark
              ? require('../assets/done_dark.png')
              : require('../assets/done.png')
          }
        />
      ),
    });
  }, [navigation, isDark]);

  const styles = createStyles(colors);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container}>
        <Text style={styles.sectionLabel}>General</Text>
        <View style={styles.card}>
          {/* 语言切换 */}
          <View style={styles.row}>
            <Globe size={16} color={colors.text} />
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Language</Text>
            </View>
            <View style={styles.langSwitcher}>
              {[
                { value: 'zh' as const, label: '中文' },
                { value: 'en' as const, label: 'English' },
              ].map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => setLanguage(opt.value)}
                  style={[
                    styles.langOption,
                    language === opt.value && styles.langOptionActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.langOptionText,
                      language === opt.value && styles.langOptionTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.divider} />

          {/* 震动开关 */}
          <View style={styles.row}>
            {hapticEnabled ? (
              <Vibrate size={16} color={colors.text} />
            ) : (
              <VibrateOff size={16} color={colors.text} />
            )}
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Vibration</Text>
              <Text style={styles.rowDesc}>
                Haptic feedback on interactions
              </Text>
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
    sectionLabel: {
      fontSize: 13,
      color: colors.textSecondary,
      marginLeft: 16,
      marginBottom: 8,
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
    divider: {
      height: 1,
      backgroundColor: colors.borderLight,
      marginLeft: 16,
      marginRight: 16,
    },
    langSwitcher: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceSecondary,
      borderRadius: 999,
      padding: 2,
    },
    langOption: {
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 999,
    },
    langOptionActive: {
      backgroundColor: colors.background,
    },
    langOptionText: {
      fontSize: 13,
      fontWeight: '500',
      color: colors.textSecondary,
    },
    langOptionTextActive: {
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
      backgroundColor: '#ffffff',
      marginHorizontal: 2,
      alignSelf: 'flex-start',
    },
    toggleKnobOn: {
      alignSelf: 'flex-end',
    },
  });

export default SettingsScreen;
