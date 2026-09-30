# React Native Web Optimizations

## 🎨 Style Compatibility

```typescript
// ✅ Use web-compatible style props
<View
  style={{
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)', // Not shadow*
    textShadow: '1px 1px 2px rgba(0,0,0,0.5)', // Not textShadow*
  }}
/>
```

## 🎭 Animation Compatibility

```typescript
// ✅ Disable useNativeDriver for web
Animated.timing(fadeAnim, {
  toValue: 1,
  duration: 300,
  useNativeDriver: false, // Required for RN Web
}).start();
```

## 🌐 Web-Specific Optimizations

```typescript
// ✅ Check platform for conditional logic
import {Platform} from 'react-native';

if (Platform.OS === 'web') {
  // Web-specific code
}

// ✅ Use web-appropriate loading strategies
const isWeb = Platform.OS === 'web';
// Adjust chunk sizes, caching, etc. for web
```

## 🚨 Web-Specific Issues to Watch

- ❌ `useNativeDriver: true` animations
- ❌ `shadow*` and `textShadow*` style props
- ❌ Native-specific libraries without web fallbacks
- ❌ Synchronous storage operations
- ❌ Platform-specific file extensions
