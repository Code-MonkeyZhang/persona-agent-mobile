/**
 * @format
 */
import 'react-native-polyfill-globals/auto';
import './src/env';
import {
  configureReanimatedLogger,
  ReanimatedLogLevel,
} from 'react-native-reanimated';
import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

// Reanimated strict mode stays off so GiftedChat animations never abort the app.
// Level is raised to error because GiftedChat passes web-only dependencies on native and no library release fixes it yet.
configureReanimatedLogger({
  level: ReanimatedLogLevel.error,
  strict: false,
});

AppRegistry.registerComponent(appName, () => App);
