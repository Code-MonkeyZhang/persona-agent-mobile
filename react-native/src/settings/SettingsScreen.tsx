import * as React from 'react';
import { useRef, useState } from 'react';
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
import Dialog from 'react-native-dialog';
import RNFS from 'react-native-fs';
import { NavigationProp, useNavigation } from '@react-navigation/native';
import { setHapticFeedbackEnabled, trigger } from '../chat/util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src';
import {
  getHapticEnabled,
  clearAllChatHistory,
  getServerAddress,
  saveServerAddress,
} from '../storage/StorageUtils.ts';
import { CustomHeaderRightButton } from '../chat/component/CustomHeaderRightButton.tsx';
import { RouteParamList } from '../types/RouteTypes.ts';

import { isMac } from '../App.tsx';
import CustomTextInput from './CustomTextInput.tsx';
import { useAppContext } from '../history/AppProvider.tsx';
import { useTheme, ColorScheme } from '../theme';

function SettingsScreen(): React.JSX.Element {
  const { colors, isDark } = useTheme();
  const [hapticEnabled, setHapticEnabled] = useState(getHapticEnabled);
  const navigation = useNavigation<NavigationProp<RouteParamList>>();
  const { sendEvent } = useAppContext();
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [clearCountdown, setClearCountdown] = useState(10);
  const [isClearing, setIsClearing] = useState(false);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
              sessionId: -1,
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

  const handleOpenClearDialog = () => {
    setShowClearDialog(true);
    setClearCountdown(10);
    countdownIntervalRef.current = setInterval(() => {
      setClearCountdown(prev => {
        if (prev <= 1) {
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleCloseClearDialog = () => {
    setShowClearDialog(false);
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setClearCountdown(10);
  };

  const handleClearAllData = async () => {
    if (clearCountdown > 0) {
      return;
    }
    setIsClearing(true);
    try {
      clearAllChatHistory();

      const documentPath = RNFS.DocumentDirectoryPath;
      const files = await RNFS.readDir(documentPath);
      for (const file of files) {
        if (
          file.name.startsWith('.') ||
          file.name === 'mmkv' ||
          file.name === 'RCTAsyncLocalStorage' ||
          file.name === 'RCTAsyncLocalStorage_V1'
        ) {
          continue;
        }
        try {
          if (file.isDirectory()) {
            await RNFS.unlink(file.path);
          } else {
            await RNFS.unlink(file.path);
          }
        } catch (e) {
          console.warn('Failed to delete file:', file.path, e);
        }
      }

      sendEvent('historyChanged');
      handleCloseClearDialog();
    } catch (error) {
      console.error('Error clearing data:', error);
    } finally {
      setIsClearing(false);
    }
  };

  const styles = createStyles(colors);

  /**
   * 验证并保存服务器连接地址。
   * 用 XMLHttpRequest 请求 /api/status，成功后存入 MMKV。
   */
  const handleConnect = async () => {
    const address = serverAddress.trim().replace(/\/+$/, '');
    console.log(`[Settings] handleConnect: address="${address}"`);
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
        console.log(`[Settings] connection ok, saving address="${address}"`);
        setConnectionStatus('connected');
        saveServerAddress(address);
      } else {
        console.log(`[Settings] unexpected response: ${JSON.stringify(data)}`);
        setConnectionStatus('failed');
        setConnectionError('Unexpected response');
      }
    } catch (e) {
      console.log(`[Settings] connection failed: ${e instanceof Error ? e.message : e}`);
      setConnectionStatus('failed');
      setConnectionError(
        e instanceof Error ? e.message : 'Connection failed'
      );
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
          disabled={connectionStatus === 'connecting'}>
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
            ]}>
            {connectionStatus === 'connecting' && 'Connecting...'}
            {connectionStatus === 'connected' && 'Connected'}
            {connectionStatus === 'failed' &&
              `Failed${connectionError ? ': ' + connectionError : ''}`}
          </Text>
        )}

        {!isMac && (
          <View style={styles.switchContainer}>
            <Text style={styles.label}>Haptic Feedback</Text>
            <Switch
              value={hapticEnabled}
              onValueChange={toggleHapticFeedback}
            />
          </View>
        )}
        <TouchableOpacity
          style={styles.clearDataButton}
          activeOpacity={0.7}
          onPress={handleOpenClearDialog}>
          <Text style={styles.clearDataButtonText}>Clear All Chat History</Text>
        </TouchableOpacity>
      </ScrollView>
      <Dialog.Container visible={showClearDialog}>
        <Dialog.Title>Clear All Data</Dialog.Title>
        <Dialog.Description>
          This will delete all chat history and saved files. This action cannot
          be undone.
          {clearCountdown > 0
            ? `\n\nPlease wait ${clearCountdown} seconds to confirm.`
            : '\n\nYou can now confirm the deletion.'}
        </Dialog.Description>
        <Dialog.Button label="Cancel" onPress={handleCloseClearDialog} />
        <Dialog.Button
          label={isClearing ? 'Clearing...' : 'Confirm'}
          onPress={handleClearAllData}
          disabled={clearCountdown > 0 || isClearing}
          color={clearCountdown > 0 ? '#999' : '#FF3B30'}
        />
      </Dialog.Container>
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
    firstLabel: {
      marginBottom: 12,
    },
    middleLabel: {
      marginTop: 10,
      marginBottom: 12,
    },
    proxyLabel: {
      fontSize: 14,
      fontWeight: '400',
      color: colors.textDarkGray,
      marginLeft: 2,
    },
    text: {
      fontSize: 14,
      fontWeight: '400',
      color: colors.textSecondary,
    },
    input: {
      height: 40,
      borderColor: colors.inputBorder,
      borderWidth: 1,
      borderRadius: 6,
      marginBottom: 16,
      marginTop: 8,
      paddingHorizontal: 10,
      color: colors.text,
      backgroundColor: colors.inputBackground,
    },
    switchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginVertical: 10,
    },
    itemContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginVertical: 10,
    },
    arrowContainer: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    arrowImage: {
      width: 16,
      height: 16,
      transform: [{ scaleX: -1 }],
      opacity: 0.6,
      marginLeft: 4,
    },
    versionContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginVertical: 10,
      paddingBottom: 60,
    },
    clearDataButton: {
      backgroundColor: '#F5F5F5',
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 20,
      marginBottom: 80,
    },
    clearDataButtonText: {
      color: '#FF3B30',
      fontSize: 16,
      fontWeight: '600',
    },
    apiKeyContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    apiKeyInputContainer: {
      flex: 1,
      marginRight: 10,
    },
    proxyContainer: {
      marginBottom: 12,
    },
    proxyMacContainer: {
      marginTop: 10,
    },
    switch: {
      marginRight: -14,
      width: 32,
      height: 32,
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
