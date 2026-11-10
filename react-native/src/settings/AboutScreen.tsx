/**
 * @file settings/AboutScreen.tsx
 * @description 关于页,设置页底部入口推入。
 *   品牌区展示应用图标、名称与版本号;信息组读 app 版本、构建号与当前主机的服务端版本,
 *   服务端版本取最近一次握手落库的值,从未连过主机时整行不渲染;
 *   导出日志链路从设置页整体迁入;项目组给开源协议与源代码外链。
 */
import * as React from 'react';
import {
  Alert,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ExternalLink, RotateCcwClock } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import Share from 'react-native-share';
import DeviceInfo from 'react-native-device-info';
import { ColorScheme, typography, useTheme } from '../theme/index.ts';
import { useDeviceStore } from '../stores/deviceStore.ts';
import { InfoRow } from '../component/InfoRow.tsx';
import { PressableRow } from '../component/PressableRow.tsx';
import { logger } from '../lib/logger';
import appIcon from '../../assets/app-icon.png';

/** 源代码仓库地址 */
const REPO_URL = 'https://github.com/Code-MonkeyZhang/persona-agent-mobile';

const AboutScreen: React.FC = () => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);

  /** 当前主机条目,version 只在握手成功后写入,为空代表从未连上过,行不渲染 */
  const currentHost = useDeviceStore((s) => {
    const hit = s.devices.find((d) => d.hostId === s.currentHostId);
    return hit && hit.version ? hit : null;
  });

  /** 导出运行日志:先落盘缓冲,再取文件清单交系统分享面板 */
  const handleExportLogs = async () => {
    logger.info('[About] export logs requested');
    await logger.flush();
    const files = await logger.listFiles();
    if (files.length === 0) {
      logger.warn('[About] no log files to export');
      Alert.alert(t('about.exportLogs'), t('about.noLogs'));
      return;
    }
    try {
      await Share.open({
        urls: files.map((path) => `file://${path}`),
        failOnCancel: false,
      });
      logger.info(`[About] logs shared, count=${files.length}`);
    } catch (e) {
      logger.error('[About] log export failed:', e);
      Alert.alert(t('about.exportLogs'), t('about.exportFailed'));
    }
  };

  /** 打开源代码仓库,系统浏览器承接 */
  const handleOpenRepo = () => {
    Linking.openURL(REPO_URL).catch((e) => {
      logger.warn('[About] open repo failed:', e);
    });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* 品牌区:应用图标、名称与版本号 */}
        <View style={styles.brand}>
          <Image source={appIcon} style={styles.brandIcon} />
          <Text style={styles.brandName}>Persona</Text>
          <Text style={styles.brandVersion}>v{DeviceInfo.getVersion()}</Text>
        </View>

        {/* 应用信息组:版本、构建号与当前主机的服务端版本 */}
        <View style={styles.group}>
          <InfoRow
            label={t('about.version')}
            value={DeviceInfo.getVersion()}
            divided={false}
          />
          <InfoRow
            label={t('about.build')}
            value={DeviceInfo.getBuildNumber()}
            divided
          />
          {currentHost && (
            <InfoRow
              label={t('about.serverVersion')}
              value={currentHost.version}
              divided
            />
          )}
        </View>

        {/* 动作组:导出运行日志 */}
        <View style={styles.group}>
          <PressableRow onPress={handleExportLogs} style={styles.actionRow}>
            <RotateCcwClock size={17} color={colors.text} />
            <Text style={styles.actionLabel}>{t('about.exportLogs')}</Text>
          </PressableRow>
        </View>

        {/* 项目组:开源协议与源代码仓库 */}
        <View style={styles.group}>
          <InfoRow
            label={t('about.license')}
            value="Apache-2.0"
            divided={false}
          />
          <PressableRow onPress={handleOpenRepo} style={styles.linkRow}>
            <Text style={styles.linkLabel}>{t('about.repo')}</Text>
            <View style={styles.linkTrailing}>
              <Text style={styles.linkValue} numberOfLines={1}>
                GitHub
              </Text>
              <ExternalLink size={14} color={colors.textTertiary} />
            </View>
          </PressableRow>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    content: {
      padding: 16,
    },
    brand: {
      alignItems: 'center',
      paddingTop: 24,
      paddingBottom: 28,
    },
    brandIcon: {
      width: 72,
      height: 72,
      borderRadius: 18,
    },
    brandName: {
      ...typography.titleSection,
      fontWeight: '600',
      color: colors.text,
      marginTop: 12,
    },
    brandVersion: {
      ...typography.caption,
      color: colors.textSecondary,
      marginTop: 4,
    },
    group: {
      backgroundColor: colors.card,
      borderRadius: 12,
      overflow: 'hidden',
      marginBottom: 18,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 11,
      minHeight: 50,
    },
    actionLabel: {
      ...typography.content,
      color: colors.text,
    },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 11,
      minHeight: 50,
    },
    linkLabel: {
      ...typography.content,
      color: colors.text,
    },
    linkTrailing: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 4,
    },
    linkValue: {
      ...typography.content,
      color: colors.textSecondary,
    },
  });

export default AboutScreen;
