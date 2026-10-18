/**
 * @file device/FirstLaunchView.tsx
 * @description 首次启动扫码入口页，登记表一台主机都没有时 HomeScreen 的替身布局。
 *   扫码是主路径，手动输入兜底，连上台主机后登记表非空本页自动让位给会话主页。
 */
import * as React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Radio, ScanLine } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ColorScheme, typography, useTheme } from '../theme/index.ts';
import type { RouteParamList } from '../types/RouteTypes.ts';

type FirstLaunchNavigationProp = NativeStackNavigationProp<
  RouteParamList,
  'Home'
>;

const FirstLaunchView: React.FC = () => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<FirstLaunchNavigationProp>();
  const insets = useSafeAreaInsets();
  const styles = createStyles(colors);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.center}>
        <View style={styles.iconWrap}>
          <Radio size={30} color={colors.primary} />
        </View>
        <Text style={styles.title}>{t('first.title')}</Text>
        <Text style={styles.desc}>{t('first.desc')}</Text>
        <TouchableOpacity
          style={styles.scanButton}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('ScanQR')}
        >
          <ScanLine size={18} color={colors.primaryForeground} />
          <Text style={styles.scanButtonText}>{t('server.scanToConnect')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.manualLink}
          activeOpacity={0.6}
          onPress={() => navigation.navigate('DeviceManage')}
        >
          <Text style={styles.manualLinkText}>{t('device.manualInput')}</Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.tip, { marginBottom: insets.bottom + 24 }]}>
        {t('first.tip')}
      </Text>
    </View>
  );
};

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
    },
    iconWrap: {
      width: 64,
      height: 64,
      borderRadius: 18,
      backgroundColor: colors.primarySelectedBackground,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    title: {
      ...typography.titleSection,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 8,
    },
    desc: {
      ...typography.content,
      color: colors.textTertiary,
      textAlign: 'center',
      lineHeight: 21,
      marginBottom: 32,
    },
    scanButton: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 13,
      borderRadius: 12,
      backgroundColor: colors.primary,
    },
    scanButtonText: {
      ...typography.body,
      fontWeight: '500',
      color: colors.primaryForeground,
    },
    manualLink: {
      marginTop: 10,
      paddingVertical: 8,
    },
    manualLinkText: {
      ...typography.content,
      color: colors.primary,
    },
    tip: {
      ...typography.caption,
      color: colors.textTertiary,
      textAlign: 'center',
      lineHeight: 18,
      paddingHorizontal: 32,
    },
  });

export default FirstLaunchView;
