import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import { Camera } from 'react-native-camera-kit';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useTheme, ColorScheme } from '../theme/index.ts';
import { logger } from '../lib/logger';
import { useConnectionStore } from '../stores/connectionStore.ts';
import type { RouteParamList } from '../types/RouteTypes.ts';

type ScanQRScreenNavigationProp = NativeStackNavigationProp<
  RouteParamList,
  'ScanQR'
>;

/**
 * @file ScanQRScreen.tsx
 * @description 纯扫码页面。扫到 URL 后立即返回 ServerScreen 并携带 scannedUrl 参数，
 *              后续配对流程由 ServerScreen 的 useEffect 处理。
 *              用 scannedRef 防止 onReadCode 连续触发。
 */
const ScanQRScreen: React.FC = () => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<ScanQRScreenNavigationProp>();
  const styles = createStyles(colors);

  const [permissionDenied, setPermissionDenied] = useState(false);
  const scannedRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA)
      .then((result) => {
        if (result !== 'granted') {
          logger.warn('[ScanQR] Camera permission denied');
          setPermissionDenied(true);
        }
      })
      .catch((e) => {
        logger.error(`[ScanQR] Permission request failed: ${e}`);
        setPermissionDenied(true);
      });
  }, []);

  /**
   * 扫码回调：提取 URL → 写入连接页的中转地址 → goBack 返回连接页。
   * 用 goBack（pop 语义）而非 navigate，避免反复扫码时页面堆叠；
   * 连接/配对逻辑统一由 ServerScreen 处理，本页面只负责扫码。
   */
  const handleReadCode = (event: {
    nativeEvent: { codeStringValue: string };
  }) => {
    if (scannedRef.current) {
      return;
    }
    scannedRef.current = true;

    const url = event.nativeEvent.codeStringValue;
    logger.info(`[ScanQR] Scanned URL: ${url}`);

    useConnectionStore.getState().setPendingScannedUrl(url);
    navigation.goBack();
  };

  if (permissionDenied) {
    return (
      <SafeAreaView style={styles.permissionContainer}>
        <Text style={styles.permissionText}>
          {t('server.cameraPermissionDenied')}
        </Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.retryButtonText}>{t('common.back')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        scanBarcode
        showFrame
        laserColor={colors.primary}
        frameColor={colors.primary}
        onReadCode={handleReadCode}
      />

      <View style={styles.statusBar}>
        <Text style={styles.statusText}>{t('server.scanning')}</Text>
      </View>
    </View>
  );
};

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#000',
    },
    permissionContainer: {
      flex: 1,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
    },
    permissionText: {
      fontSize: 16,
      color: colors.text,
      textAlign: 'center',
      marginBottom: 24,
    },
    statusBar: {
      position: 'absolute',
      bottom: 60,
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    statusText: {
      fontSize: 15,
      color: '#fff',
    },
    retryButton: {
      paddingHorizontal: 24,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: 'rgba(255,255,255,0.15)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.3)',
    },
    retryButtonText: {
      fontSize: 14,
      color: '#fff',
      fontWeight: '500',
    },
  });

export default ScanQRScreen;
