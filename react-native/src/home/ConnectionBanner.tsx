/**
 * @file home/ConnectionBanner.tsx
 * @description 会话主页内容列顶部的连接态条。
 *   - connecting 与 reconnecting 出蓝条过渡，重连由 ws-client 自动进行，不可点
 *   - 断线停滞出红条整条可点，address_invalid 提示检查地址，其余点击以当前地址立即重连重置退避
 *   - 已连接不显示任何条
 */
import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WifiOff } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, ColorScheme } from '../theme/index.ts';
import { useConnectionStore } from '../stores/connectionStore.ts';

interface ConnectionBannerProps {
  /** 红条点击回调，由宿主决定重连还是进 Server */
  onPress: () => void;
}

const ConnectionBanner: React.FC<ConnectionBannerProps> = ({ onPress }) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const status = useConnectionStore((s) => s.status);
  const styles = createStyles(colors);

  if (status === 'connected') {
    return null;
  }

  if (status === 'connecting' || status === 'reconnecting') {
    return (
      <View style={[styles.banner, styles.bannerTransient]}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.text, { color: colors.primary }]}>
          {status === 'connecting'
            ? t('server.connecting')
            : t('connection.reconnecting')}
        </Text>
      </View>
    );
  }

  const isInvalid = status === 'address_invalid';
  return (
    <TouchableOpacity
      style={[styles.banner, styles.bannerStalled]}
      activeOpacity={0.8}
      onPress={onPress}
    >
      <WifiOff size={18} color={colors.primaryForeground} />
      <Text style={[styles.text, styles.textStalled]}>
        {isInvalid ? t('home.connInvalid') : t('home.connFailed')}
      </Text>
      {!isInvalid && (
        <View style={styles.reconnectPill}>
          <Text style={styles.reconnectText}>{t('home.tapReconnect')}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

/** 连接态条样式工厂，红蓝两态共用同一高度避免状态切换时跳动 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    banner: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    bannerTransient: {
      backgroundColor: colors.primarySelectedBackground,
    },
    bannerStalled: {
      backgroundColor: colors.error,
    },
    text: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
    },
    textStalled: {
      color: colors.primaryForeground,
    },
    /** 红条右端的白底重连胶囊 */
    reconnectPill: {
      height: 34,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 17,
      backgroundColor: colors.primaryForeground,
    },
    reconnectText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.error,
    },
  });

export default ConnectionBanner;
