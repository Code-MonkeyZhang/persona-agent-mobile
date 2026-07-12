import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/index.ts';

/**
 * @file ToolsScreen.tsx
 * @description 工具管理页面占位组件，步骤 09 替换为完整实现。
 */
const ToolsScreen: React.FC = () => {
  const { colors } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.text, { color: colors.textSecondary }]}>Tools</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 16,
  },
});

export default ToolsScreen;
