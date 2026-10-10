/**
 * @format
 */
import 'react-native-polyfill-globals/auto';
import {
  configureReanimatedLogger,
  ReanimatedLogLevel,
} from 'react-native-reanimated';
import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

// Downgrade Reanimated strict logs to warnings so GiftedChat animations never abort the app.
configureReanimatedLogger({
  level: ReanimatedLogLevel.warn,
  strict: false,
});

AppRegistry.registerComponent(appName, () => App);
