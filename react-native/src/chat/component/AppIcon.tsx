/**
 * @file AppIcon.tsx
 * @description Agent App 图标，带首字母回退。
 *   底层渲染首字母，优先取 label 显示名、缺省回落 name；上层覆盖 icon.png。
 */
import * as React from 'react';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/index.ts';

interface AppIconProps {
  /** 机器键，图标走 /apps/:name 反代路径 */
  name: string;
  /** 显示名，兜底字母从这里取首字，缺省回落 name */
  label?: string;
  serverAddress: string;
  size: number;
}

const AppIcon: React.FC<AppIconProps> = ({
  name,
  label,
  serverAddress,
  size,
}) => {
  const { colors } = useTheme();
  const [iconError, setIconError] = useState(false);
  const borderRadius = size * 0.2;

  return (
    <View
      style={[
        styles.box,
        {
          width: size,
          height: size,
          borderRadius,
          backgroundColor: colors.surface,
        },
      ]}
    >
      <Text
        style={[
          styles.letter,
          { fontSize: size * 0.4, color: colors.textTertiary },
        ]}
      >
        {(label ?? name).charAt(0).toUpperCase()}
      </Text>
      {!iconError && (
        <Image
          source={{ uri: `${serverAddress}/apps/${name}/icon.png` }}
          style={[styles.image, { width: size, height: size, borderRadius }]}
          onError={() => setIconError(true)}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  letter: {
    fontWeight: '600',
  },
  image: {
    position: 'absolute',
  },
});

export default AppIcon;
