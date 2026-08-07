import { registerRootComponent } from 'expo';

// Register the background tasks at module top-level so they exist even when
// the OS relaunches the app headlessly (required by expo-task-manager).
import './src/location/backgroundTask';
import './src/upload/backgroundSync';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
