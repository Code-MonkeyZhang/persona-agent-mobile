import * as React from 'react';
import { useState } from 'react';
import {
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { NavigationProp, useNavigation } from '@react-navigation/native';
import { setHapticFeedbackEnabled, trigger } from '../chat/util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/index.ts';
import {
  getHapticEnabled,
  getServerAddress,
  saveServerAddress,
} from '../storage/StorageUtils.ts';
import { CustomHeaderRightButton } from '../chat/component/CustomHeaderRightButton.tsx';
import { RouteParamList } from '../types/RouteTypes.ts';

import CustomTextInput from './CustomTextInput.tsx';
import { useTheme, ColorScheme } from '../theme/index.ts';
import { logger } from '../lib/logger';

function SettingsScreen(): React.JSX.Element {
  const { colors, isDark } = useTheme();
  const [hapticEnabled, setHapticEnabled] = useState(getHapticEnabled);
  const navigation = useNavigation<NavigationProp<RouteParamList>>();

  const savedAddress = getServerAddress();
  const [serverAddress, setServerAddress] = useState(savedAddress);
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'failed'
  >(savedAddress ? 'connected' : 'idle');
  const [connectionError, setConnectionError] = useState('');

  const toggleHapticFeedback = (value: boolean) => {
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

  /**
   * 验证并保存服务器连接地址。
   * 用 XMLHttpRequest 请求 /api/status，成功后存入 MMKV。
   */
  const handleConnect = async () => {
    const address = serverAddress.trim().replace(/\/+$/, '');
    logger.info(`[Settings] handleConnect: address="${address}"`);
    if (!address) {
      setConnectionStatus('failed');
      setConnectionError('Please enter a server address');
      return;
    }
    setServerAddress(address);
    setConnectionStatus('connecting');
    setConnectionError('');
    try {
      const data = await new Promise<{ status: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const timer = setTimeout(() => {
          xhr.abort();
          reject(new Error('Timeout (10s)'));
        }, 10000);
        xhr.onreadystatechange = () => {
          if (xhr.readyState === 4) {
            clearTimeout(timer);
            if (xhr.status === 200) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch {
                reject(new Error('Invalid response'));
              }
            } else {
              reject(new Error(`HTTP ${xhr.status}`));
            }
          }
        };
        xhr.onerror = () => {
          clearTimeout(timer);
          reject(new Error('Network error'));
        };
        xhr.open('GET', address + '/api/status');
        xhr.send();
      });
      if (data.status === 'ok') {
        logger.info(`[Settings] connection ok, saving address="${address}"`);
        setConnectionStatus('connected');
        saveServerAddress(address);
      } else {
        logger.warn(`[Settings] unexpected response: ${JSON.stringify(data)}`);
        setConnectionStatus('failed');
        setConnectionError('Unexpected response');
      }
    } catch (e) {
      logger.error(
        `[Settings] connection failed: ${e instanceof Error ? e.message : e}`
      );
      setConnectionStatus('failed');
      setConnectionError(e instanceof Error ? e.message : 'Connection failed');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container}>
        <Text style={styles.sectionTitle}>Server Connection</Text>
        <CustomTextInput
          label="Tunnel Address"
          value={serverAddress}
          onChangeText={setServerAddress}
          placeholder="https://xxx.trycloudflare.com"
        />
        <TouchableOpacity
          style={[
            styles.connectButton,
            connectionStatus === 'connecting' && styles.connectButtonDisabled,
          ]}
          activeOpacity={0.7}
          onPress={handleConnect}
          disabled={connectionStatus === 'connecting'}
        >
          <Text style={styles.connectButtonText}>
            {connectionStatus === 'connecting' ? 'Connecting...' : 'Connect'}
          </Text>
        </TouchableOpacity>
        {connectionStatus !== 'idle' && (
          <Text
            style={[
              styles.statusText,
              connectionStatus === 'connecting' && { color: colors.info },
              connectionStatus === 'connected' && { color: colors.success },
              connectionStatus === 'failed' && { color: colors.error },
            ]}
          >
            {connectionStatus === 'connecting' && 'Connecting...'}
            {connectionStatus === 'connected' && 'Connected'}
            {connectionStatus === 'failed' &&
              `Failed${connectionError ? ': ' + connectionError : ''}`}
          </Text>
        )}

        <View style={styles.switchContainer}>
          <Text style={styles.label}>Haptic Feedback</Text>
          <Switch value={hapticEnabled} onValueChange={toggleHapticFeedback} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      flex: 1,
      padding: 20,
    },
    label: {
      fontSize: 16,
      fontWeight: '500',
      color: colors.text,
    },
    switchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginVertical: 10,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
      marginTop: 24,
      marginBottom: 8,
    },
    connectButton: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
    },
    connectButtonDisabled: {
      opacity: 0.6,
    },
    connectButtonText: {
      color: '#ffffff',
      fontSize: 15,
      fontWeight: '600',
    },
    statusText: {
      fontSize: 13,
      marginTop: 8,
      marginBottom: 4,
    },
  });

export default SettingsScreen;
