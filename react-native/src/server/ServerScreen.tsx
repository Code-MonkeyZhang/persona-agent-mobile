import * as React from 'react';
import { useState, useRef, useCallback } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Link as LinkIcon, Check, ScanLine } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme, ColorScheme } from '../theme/index.ts';
import { getServerAddress } from '../storage/StorageUtils.ts';
import { useConnectionStore } from '../stores/connectionStore.ts';
import { logger } from '../lib/logger';
import type { RouteParamList } from '../types/RouteTypes.ts';

type ServerScreenNavigationProp = NativeStackNavigationProp<
  RouteParamList,
  'Server'
>;

/** 翻译函数类型，仅依赖 key，便于 mapConnectError 独立测试 */
type TFunc = (key: string) => string;

/**
 * 将底层原始错误映射为面向用户的友好文案。
 * - Network error / Request timeout / HTTP 状态码 按类归并
 * - 其余未知内容截断到 60 字符兜底，避免超长错误铺满界面
 */
function mapConnectError(raw: string, t: TFunc): string {
  const s = raw.trim();
  if (!s) {
    return '';
  }
  if (/^network error/i.test(s)) {
    return t('server.errNetwork');
  }
  if (/^request timeout/i.test(s)) {
    return t('server.errTimeout');
  }
  const m = s.match(/^HTTP\s+(\d{3})/i);
  if (m) {
    const code = Number(m[1]);
    if (code === 404) {
      return t('server.errHttp404');
    }
    if (code >= 500) {
      return t('server.errHttp5xx');
    }
    return `HTTP ${code}`;
  }
  return s.length > 60 ? s.slice(0, 60) + '…' : s;
}

/**
 * @file ServerScreen.tsx
 * @description 服务器隧道连接页面。扫码与手输地址合并在同一卡片，
 *              通过 connectionStore 发起配对请求并建立 WebSocket 连接，
 *              连接态由底部状态横幅统一反馈。
 */
const ServerScreen: React.FC = () => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<ServerScreenNavigationProp>();

  const status = useConnectionStore((s) => s.status);
  const error = useConnectionStore((s) => s.error);

  const savedAddress = getServerAddress();
  const [url, setUrl] = useState(savedAddress);

  const styles = createStyles(colors);

  /** 提交连接：清洗地址后调用 store.connect，触发配对与 WS 建链 */
  const handleSave = async (overrideUrl?: string) => {
    const targetUrl = (overrideUrl ?? url).trim();
    if (!targetUrl) {
      return;
    }
    logger.info(`[Server] handleSave: address="${targetUrl}"`);
    await useConnectionStore.getState().connect(targetUrl);
  };

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  /**
   * 聚焦时消费扫码页写入的中转地址：回填输入框并发起连接。
   * ScanQR 用 goBack 返回无法携带参数，故经 connectionStore.pendingScannedUrl 回传；
   * 用完即清，避免下次聚焦重复触发。
   */
  useFocusEffect(
    useCallback(() => {
      const scannedUrl = useConnectionStore.getState().pendingScannedUrl;
      if (!scannedUrl) {
        return;
      }
      useConnectionStore.getState().setPendingScannedUrl('');
      logger.info(`[Server] Received scannedUrl: ${scannedUrl}`);
      setUrl(scannedUrl);
      handleSaveRef.current(scannedUrl);
    }, [])
  );

  const isConnecting = status === 'connecting';
  const isConnected = status === 'connected';
  const isFailed = status === 'address_invalid';

  const failedText = isFailed
    ? (() => {
        const mapped = mapConnectError(error, t);
        return mapped ? `${t('server.failed')}：${mapped}` : t('server.failed');
      })()
    : '';

  const connectDisabled = isConnecting || !url.trim();

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container}>
        {/* 扫码 + 地址输入：同一个方块 */}
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.scanButton}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('ScanQR')}
          >
            <ScanLine size={18} color={colors.primary} />
            <Text style={styles.scanButtonText}>
              {t('server.scanToConnect')}
            </Text>
          </TouchableOpacity>

          <View style={styles.inputWrap}>
            <LinkIcon
              size={18}
              color={colors.textTertiary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              value={url}
              onChangeText={setUrl}
              placeholder={t('server.placeholder')}
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>
        </View>

        {/* 连接主按钮 */}
        <TouchableOpacity
          style={[
            styles.connectButton,
            connectDisabled && styles.connectButtonDisabled,
          ]}
          activeOpacity={0.7}
          onPress={() => handleSave()}
          disabled={connectDisabled}
        >
          {isConnecting ? (
            <View style={styles.connectButtonContent}>
              <ActivityIndicator
                size="small"
                color={colors.primaryForeground}
              />
              <Text style={styles.connectButtonText}>
                {t('server.connecting')}
              </Text>
            </View>
          ) : (
            <Text style={styles.connectButtonText}>{t('server.connect')}</Text>
          )}
        </TouchableOpacity>

        {/* 状态横幅：已连接 / 失败，连接中由按钮内转圈表达 */}
        {isConnected && (
          <View style={[styles.banner, styles.bannerConnected]}>
            <Check size={18} color={colors.success} />
            <Text style={[styles.bannerText, { color: colors.success }]}>
              {t('server.connected')}
            </Text>
          </View>
        )}
        {isFailed && failedText ? (
          <View style={[styles.banner, styles.bannerFailed]}>
            <Text
              style={[styles.bannerText, { color: colors.error }]}
              numberOfLines={2}
            >
              {failedText}
            </Text>
          </View>
        ) : null}
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
    container: {
      flex: 1,
      padding: 16,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
      gap: 12,
    },
    scanButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: colors.primarySelectedBackground,
      borderWidth: 1,
      borderColor: colors.primaryBorder,
    },
    scanButtonText: {
      color: colors.primary,
      fontSize: 15,
      fontWeight: '600',
    },
    inputWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.messageBackground,
      borderRadius: 10,
      paddingLeft: 12,
    },
    inputIcon: {
      position: 'absolute',
      left: 12,
    },
    input: {
      flex: 1,
      paddingVertical: 12,
      paddingLeft: 32,
      paddingRight: 12,
      fontSize: 16,
      color: colors.text,
    },
    connectButton: {
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 12,
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: colors.primary,
    },
    connectButtonDisabled: {
      backgroundColor: colors.primaryDisabled,
    },
    connectButtonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    connectButtonText: {
      color: colors.primaryForeground,
      fontSize: 16,
      fontWeight: '600',
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 12,
    },
    bannerConnected: {
      backgroundColor: colors.successBackground,
    },
    bannerFailed: {
      backgroundColor: colors.errorBackground,
    },
    bannerText: {
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
    },
  });

export default ServerScreen;
