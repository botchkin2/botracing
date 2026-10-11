// Native keeps Reanimated loaded exactly as before (brake, #543): the app root imports
// '@/src/setup/reanimated', which is this file on Android and iOS and an empty
// module on web (reanimated.ts), where nothing uses it and it was 751 KB.
import 'react-native-reanimated';
