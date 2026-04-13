import React from 'react';
import {
  Text,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import LoadingSpinner from './LoadingSpinner';
import { ChatMode } from '../../types/Chat.ts';
import { useNavigation } from '@react-navigation/native';
import { RouteParamList } from '../../types/RouteTypes.ts';
import { DrawerNavigationProp } from '@react-navigation/drawer';
import { useTheme, ColorScheme } from '../../theme';

const isAndroid = Platform.OS === 'android';
type NavigationProp = DrawerNavigationProp<RouteParamList>;

interface EmptyChatComponentProps {
  chatMode: ChatMode;
  isLoadingMessages?: boolean;
}

export const EmptyChatComponent = ({
  chatMode,
  isLoadingMessages = false,
}: EmptyChatComponentProps): React.ReactElement => {
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProp>();

  const styles = createStyles(colors);

  return (
    <View style={styles.emptyChatContainer}>
      <TouchableOpacity
        onPress={() => {
          navigation.navigate('Settings', {});
        }}>
        {isLoadingMessages ? (
          <LoadingSpinner
            visible={true}
            size={24}
            isRotate={!isAndroid}
            source={require('../../assets/loading.png')}
          />
        ) : (
          <Text style={styles.greetingText}>Hi, I&apos;m AI</Text>
        )}
      </TouchableOpacity>
    </View>
  );
};

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    emptyChatContainer: {
      justifyContent: 'center',
      alignItems: 'center',
      flex: 1,
    },
    greetingText: {
      fontSize: 16,
      fontWeight: '500',
      paddingHorizontal: 16,
      textAlign: 'center',
      color: colors.textDarkGray,
      transform: [{ scaleY: -1 }, { scaleX: isAndroid ? -1 : 1 }],
    },
  });
