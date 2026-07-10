import { LogBox } from 'react-native';
import { logger } from '../lib/logger';

/**
 * Configure global error handling and warning suppression
 */
export const configureErrorHandling = () => {
  LogBox.ignoreLogs([/Invalid\s+responseType:\s+blob/i]);
  logger.info('[App] LogBox ignoreLogs configured');
};
