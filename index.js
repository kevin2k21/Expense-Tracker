/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { processPendingSms } from './src/features/sms/importer';

AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerHeadlessTask(
  'ProcessTransactionSms',
  () => processPendingSms,
);
