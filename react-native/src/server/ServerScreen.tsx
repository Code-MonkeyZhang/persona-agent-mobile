import * as React from 'react';
import { useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Link as LinkIcon, Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, ColorScheme } from '../theme/index.ts';
import {
  getServerAddress,
  saveServerAddress,
} from '../storage/StorageUtils.ts';
import { logger } from '../lib/logger';

/**
 * @file ServerScreen.tsx
 * @description 服务器隧道连接页面。用户输入 Cloudflare 隧道地址，
 *              校验 /api/status 通过后保存到 MMKV。接管原 SettingsScreen 的连接功能。
 */
const ServerScreen: React.FC = () => {
  const { colors } = useTheme();
  const { t } = useTranslation();

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
   * 用 XMLHttpRequest 请求 /api/status，成功后存入 MMKV。
   */
  const handleSave = async () => {
    const address = url.trim().replace(/\/+$/, '');
    logger.info(`[Server] handleSave: address="${address}"`);
    if (!address) {
      setStatus('failed');
      setError(t('server.enterAddress'));
      return;
    }
    setUrl(address);
    setStatus('connecting');
    setError('');
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
        logger.info(`[Server] connection ok, saving address="${address}"`);
        setStatus('connected');
        saveServerAddress(address);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        logger.warn(`[Server] unexpected response: ${JSON.stringify(data)}`);
        setStatus('failed');
        setError('Unexpected response');
      }
    } catch (e) {
      logger.error(
        `[Server] connection failed: ${e instanceof Error ? e.message : e}`
      );
      setStatus('failed');
      setError(e instanceof Error ? e.message : 'Connection failed');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container}>
        <View style={styles.card}>
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
            onPress={handleSave}
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
