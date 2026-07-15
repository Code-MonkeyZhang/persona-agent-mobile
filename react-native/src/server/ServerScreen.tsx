import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import {
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
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme, ColorScheme } from '../theme/index.ts';
import { getServerAddress } from '../storage/StorageUtils.ts';
import { connectToServer } from '../api/connection-service.ts';
import { logger } from '../lib/logger';
import type { RouteParamList } from '../types/RouteTypes.ts';

type ServerScreenNavigationProp = NativeStackNavigationProp<
  RouteParamList,
  'Server'
>;
type ServerScreenRouteProp = RouteProp<RouteParamList, 'Server'>;

/**
 * @file ServerScreen.tsx
 * @description 服务器隧道连接页面。支持手动输入地址和扫码连接两种方式，
 *              通过 connection-service 发送配对请求并保存到 MMKV。
 */
const ServerScreen: React.FC = () => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<ServerScreenNavigationProp>();
  const route = useRoute<ServerScreenRouteProp>();

  const savedAddress = getServerAddress();
  const [url, setUrl] = useState(savedAddress);
  const [status, setStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'failed'
  >(savedAddress ? 'connected' : 'idle');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const styles = createStyles(colors);

  /**
   * 校验隧道地址连通性并保存。
   * 调用 connection-service 完成实际请求和存储，组件只管 UI 状态。
   * 支持 overrideUrl 参数（扫码场景下由 useEffect 传入）。
   */
  const handleSave = async (overrideUrl?: string) => {
    const targetUrl = (overrideUrl ?? url).trim();
    if (!targetUrl) {
      setStatus('failed');
      setError(t('server.enterAddress'));
      return;
    }
    setStatus('connecting');
    setError('');
    logger.info(`[Server] handleSave: address="${targetUrl}"`);

    const result = await connectToServer(targetUrl);
    if (result.success) {
      logger.info('[Server] connection ok');
      setStatus('connected');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      logger.error(`[Server] connection failed: ${result.error}`);
      setStatus('failed');
      setError(result.error ?? 'Connection failed');
    }
  };

  // 保存 handleSave 的最新引用，供 useEffect 安全调用
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  /**
   * 监听 scannedUrl 导航参数：扫码页面返回后自动填充地址并触发连接。
   * 用 ref 避免 StrictMode / 重渲染重复触发。
   */
  useEffect(() => {
    const scannedUrl = route.params?.scannedUrl;
    if (!scannedUrl) {
      return;
    }
    logger.info(`[Server] Received scannedUrl: ${scannedUrl}`);
    setUrl(scannedUrl);
    handleSaveRef.current(scannedUrl);
    navigation.setParams({ scannedUrl: undefined });
  }, [route.params?.scannedUrl, navigation]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container}>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.scanButton}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('ScanQR')}
          >
            <ScanLine size={19} color={colors.primary} />
            <Text style={styles.scanButtonText}>
              {t('server.scanToConnect')}
            </Text>
          </TouchableOpacity>

          <View style={styles.inputWrap}>
            <LinkIcon
              size={19}
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

          <TouchableOpacity
            style={[
              styles.saveButton,
              saved && styles.saveButtonSaved,
              !url.trim() && styles.saveButtonDisabled,
            ]}
            activeOpacity={0.7}
            onPress={() => handleSave()}
            disabled={status === 'connecting' || !url.trim()}
          >
            {saved ? (
              <Check size={19} color={colors.primaryForeground} />
            ) : (
              <Text style={styles.saveButtonText}>{t('server.connect')}</Text>
            )}
          </TouchableOpacity>

          {status !== 'idle' && (
            <Text
              style={[
                styles.statusText,
                status === 'connecting' && { color: colors.info },
                status === 'connected' && { color: colors.success },
                status === 'failed' && { color: colors.error },
              ]}
            >
              {status === 'connecting' && t('server.connecting')}
              {status === 'connected' && t('server.connected')}
              {status === 'failed' &&
                `${t('server.failed')}${error ? ': ' + error : ''}`}
            </Text>
          )}
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
    container: {
      flex: 1,
      padding: 16,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
      gap: 12,
      borderWidth: 1,
      borderColor: colors.borderLight,
    },
    scanButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    scanButtonText: {
      color: colors.primary,
      fontSize: 15,
      fontWeight: '600',
    },
    inputWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.inputBackground,
      borderRadius: 12,
      paddingLeft: 12,
      borderWidth: 1,
      borderColor: colors.inputBorder,
    },
    inputIcon: {
      position: 'absolute',
      left: 12,
    },
    input: {
      flex: 1,
      paddingVertical: 10,
      paddingLeft: 32,
      paddingRight: 12,
      fontSize: 17,
      color: colors.text,
    },
    saveButton: {
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: colors.primary,
    },
    saveButtonSaved: {
      backgroundColor: colors.success,
    },
    saveButtonDisabled: {
      backgroundColor: colors.textTertiary,
    },
    saveButtonText: {
      color: colors.primaryForeground,
      fontSize: 17,
      fontWeight: '600',
    },
    statusText: {
      fontSize: 16,
      marginTop: 4,
    },
  });

export default ServerScreen;
