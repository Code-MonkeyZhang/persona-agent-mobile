/**
 * @file CustomTextInput.tsx
 * @description 通用文本输入框组件，支持：
 * - 浮动标签（label 绝对定位在边框上方）
 * - 密码模式（带眼睛图标切换明文/密文）
 * - 多行模式（通过 numberOfLines 控制）
 * 用于设置页的服务器地址、API Key 等输入场景。
 */
import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  TouchableOpacity,
  Image,
  Platform,
} from 'react-native';
import { useTheme, ColorScheme } from '../theme';

/** 文本输入框 Props */
interface CustomTextInputProps {
  /** 浮动标签文字 */
  label: string;
  /** 输入框当前值 */
  value: string;
  /** 文本变化回调 */
  onChangeText: (text: string) => void;
  /** 无输入时的占位提示文字 */
  placeholder: string;
  /** 是否为密码输入框（显示眼睛图标切换明文/密文） */
  secureTextEntry?: boolean;
  /** 输入框行数，>1 时启用多行模式 */
  numberOfLines?: number;
}

const CustomTextInput: React.FC<CustomTextInputProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  numberOfLines = 1,
}) => {
  const { colors } = useTheme();
  /** 密码可见性状态：true = 明文显示 */
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  /** 切换密码明文/密文显示 */
  const togglePasswordVisibility = () => {
    setIsPasswordVisible(!isPasswordVisible);
  };

  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      {/* 浮动标签：绝对定位在输入框边框线上方 */}
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputContainer}>
        <TextInput
          style={{
            ...styles.input,
            ...(secureTextEntry && styles.inputPadding),
            ...(numberOfLines > 1 && { lineHeight: 22 }),
          }}
          value={value}
          numberOfLines={Platform.OS === 'ios' ? numberOfLines : undefined}
          multiline={numberOfLines > 1}
          onChangeText={onChangeText}
          placeholder={placeholder}
          secureTextEntry={secureTextEntry && !isPasswordVisible}
        />
        {/* 密码模式：显示眼睛图标切换明文/密文 */}
        {secureTextEntry && (
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={togglePasswordVisibility}
          >
            <Image
              source={
                isPasswordVisible
                  ? require('../assets/eye_close.png')
                  : require('../assets/eye.png')
              }
              style={styles.eyeIcon}
            />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

/** 样式工厂函数 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    /** 外层容器 */
    container: {
      marginBottom: 12,
      marginTop: 8,
    },
    label: {
      position: 'absolute',
      backgroundColor: colors.labelBackground,
      color: colors.textDarkGray,
      left: 8,
      top: -8,
      zIndex: 999,
      paddingHorizontal: 4,
      fontSize: 12,
      fontWeight: '500',
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      position: 'relative',
    },
    input: {
      minHeight: 44,
      maxHeight: 160,
      borderColor: colors.inputBorder,
      borderWidth: 1,
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 12,
      color: colors.text,
      backgroundColor: colors.inputBackground,
      flex: 1,
    },
    inputPadding: {
      paddingRight: 40,
    },
    eyeButton: {
      position: 'absolute',
      right: 0,
      height: 44,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 12,
    },
    eyeIcon: {
      width: 16,
      height: 16,
      resizeMode: 'contain',
    },
  });

export default CustomTextInput;
