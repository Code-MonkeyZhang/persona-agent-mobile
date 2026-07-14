import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { useTheme } from '../../theme/index.ts';

export const CustomScrollToBottomComponent = (): React.ReactNode => {
  const { colors } = useTheme();
  return (
    <View style={styles.scrollToBottomContainer}>
      <ChevronDown size={24} color={colors.text} />
    </View>
  );
};

const styles = StyleSheet.create({
  scrollToBottomContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
