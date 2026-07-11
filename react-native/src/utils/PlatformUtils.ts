import { NativeModules, Platform } from 'react-native';

const { PlatformModule } = NativeModules;

export const isAndroid = Platform.OS === 'android';

export const getBuildNumber = (): string => {
  if (Platform.OS === 'ios') {
    return PlatformModule?.buildNumber ?? '';
  }
  return '';
};
