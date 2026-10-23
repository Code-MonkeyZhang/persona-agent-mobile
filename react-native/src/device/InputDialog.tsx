/**
 * @file device/InputDialog.tsx
 * @description 设备页共用的居中输入对话框。
 *   标题、图标、占位与确认文案由调用方给定，手输地址与改名共用同一副骨架，
 *   可选的红字提示行用于连接失败原地展示，收层时机由调用方裁决。
 */
import * as React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { ColorScheme, typography, useTheme } from '../theme/index.ts';

/** 居中输入对话框，取消恒在左侧，确认文案与禁用态由调用方裁决，红字提示行可选 */
function InputDialog({
  visible,
  title,
  icon,
  value,
  onChange,
  onCancel,
  onConfirm,
  confirmLabel,
  confirmDisabled,
  placeholder,
  keyboardType,
  error,
}: {
  visible: boolean;
  title: string;
  icon?: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  confirmDisabled: boolean;
  placeholder?: string;
  keyboardType?: 'default' | 'url';
  error?: string;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        style={styles.dialogAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity
          style={styles.dialogOverlay}
          activeOpacity={1}
          onPress={onCancel}
        >
          <TouchableOpacity
            style={styles.dialogCard}
            activeOpacity={1}
            onPress={() => undefined}
          >
            <Text style={styles.dialogTitle}>{title}</Text>
            <View style={styles.dialogInputBar}>
              {icon}
              <TextInput
                autoFocus
                style={styles.dialogInput}
                value={value}
                onChangeText={onChange}
                placeholder={placeholder}
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={keyboardType ?? 'default'}
                onSubmitEditing={confirmDisabled ? undefined : onConfirm}
                returnKeyType="go"
              />
            </View>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <View style={styles.dialogBtnRow}>
              <TouchableOpacity
                style={styles.dialogCancelBtn}
                activeOpacity={0.6}
                onPress={onCancel}
              >
                <Text style={styles.dialogCancelText}>
                  {t('common.cancel')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.dialogConfirmBtn,
                  confirmDisabled && styles.dialogConfirmBtnDisabled,
                ]}
                activeOpacity={0.7}
                disabled={confirmDisabled}
                onPress={onConfirm}
              >
                <Text style={styles.dialogConfirmText}>{confirmLabel}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    dialogAvoid: {
      flex: 1,
    },
    dialogOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
    },
    dialogCard: {
      width: '100%',
      maxWidth: 340,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 20,
    },
    dialogTitle: {
      ...typography.bodyLg,
      fontWeight: '600',
      color: colors.text,
      textAlign: 'center',
      marginBottom: 14,
    },
    dialogInputBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      height: 44,
      borderRadius: 12,
      backgroundColor: colors.messageBackground,
      borderWidth: 1,
      borderColor: colors.borderLight,
      paddingHorizontal: 12,
    },
    dialogInput: {
      flex: 1,
      ...typography.content,
      color: colors.text,
    },
    errorText: {
      ...typography.caption,
      color: colors.error,
      textAlign: 'center',
      marginTop: 10,
    },
    dialogBtnRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 16,
    },
    dialogCancelBtn: {
      flex: 1,
      height: 42,
      borderRadius: 12,
      backgroundColor: colors.messageBackground,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dialogCancelText: {
      ...typography.body,
      fontWeight: '500',
      color: colors.textSecondary,
    },
    dialogConfirmBtn: {
      flex: 1,
      height: 42,
      borderRadius: 12,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dialogConfirmBtnDisabled: {
      backgroundColor: colors.primaryDisabled,
    },
    dialogConfirmText: {
      ...typography.body,
      fontWeight: '600',
      color: colors.primaryForeground,
    },
  });

export default InputDialog;
